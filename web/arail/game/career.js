/**
 * The career mode's model: one person's working life through the roles of the role catalogue
 * (roles.js, web/game/roles/roles.json), as a graph of possibilities, not a path laid out in advance.
 *
 * The catalogue's qualifications (school certificates, apprenticeships, degrees, function trainings,
 * licences, certificates, exams) each need other qualifications first (`requires`: alternatives of
 * sets) and take months; some can be done alongside a job. Each role says how one gets in (`access`):
 * whether it is a job at all, how it is filled (application, internal, election, appointment), a
 * minimum age, the fitness needed, and its routes in, alternatives of a set of qualifications and
 * years of experience in other roles; and what is gained in it after a year (`gains`).
 *
 * A person starts from a school certificate. At every point some jobs are open (a route whose
 * qualifications are held and whose experience is there) and some educations can be started (their
 * prerequisites held); the player chooses one, or works on in the current role. For a role aimed at,
 * the model tells what is missing on each route and what each missing qualification needs first.
 * Deterministic, without the DOM: the career mode's pages and the tests use it alike.
 * @module arail/game/career
 */

/** How a role is filled. */
export const SELECTIONS = ["application", "internal", "election", "appointment", "none"];
/** Kinds of qualifications. */
export const QUALIFICATION_KINDS = ["school", "apprenticeship", "degree", "training", "licence", "certificate", "exam"];

/** Age at the end of school by the school certificate (the start of a career). */
const START_AGE = { school: 16 };
const ABITUR = /abitur|hochschulreife|fachhochschulreife/i;

/** The catalogue's qualifications by id. */
export function qualificationsOf(cat) {
  return new Map((cat.qualifications || []).map((q) => [q.id, q]));
}

/** The school certificates a career can start from, with the age at that point. */
export function startPoints(cat) {
  return (cat.qualifications || []).filter((q) => q.kind === "school" && !(q.requires || []).some((s) => s.length)).map((q) => ({
    id: q.id, name: q.name, name_de: q.name_de, age: ABITUR.test(`${q.id} ${q.name_de}`) ? 18 : START_AGE.school,
  }));
}

/**
 * A new career from a school certificate.
 * @returns {{start: string, months: number, startAge: number, qualifications: Map<string, number>, months_in: Map<string, number>, current: string | null, log: Array<{at: number, kind: string, id: string, text: string}>}}
 */
export function createCareer(cat, start) {
  const s = startPoints(cat).find((x) => x.id === start);
  if (!s) throw new Error(`Not a school certificate to start from: ${start}`);
  const p = { start, months: 0, startAge: s.age, qualifications: new Map([[start, 0]]), months_in: new Map(), current: null, log: [] };
  note(p, "start", start, `Leaves school with: ${s.name}`);
  return p;
}

/** A person's age in years. */
export const ageOf = (p) => p.startAge + Math.floor(p.months / 12);

function note(p, kind, id, text) {
  p.log.push({ at: p.months, kind, id, text });
}

/** Years worked in any of these roles. */
export function yearsIn(p, roles) {
  return roles.reduce((s, r) => s + (p.months_in.get(r) || 0), 0) / 12;
}

/** Whether the prerequisites of a qualification are held (one of its alternatives completely). */
export function canStart(cat, p, qid) {
  const q = qualificationsOf(cat).get(qid);
  if (!q || p.qualifications.has(qid)) return false;
  const alts = (q.requires || []).filter((s) => s.length);
  return !alts.length || alts.some((s) => s.every((x) => p.qualifications.has(x)));
}

/**
 * How far a person is on one route into a role: the qualifications and experience missing.
 * @returns {{ok: boolean, qualifications: string[], experience: Array<{roles: string[], years: number, have: number}>}}
 */
export function routeStatus(p, route) {
  const qualifications = (route.qualifications || []).filter((q) => !p.qualifications.has(q));
  const experience = (route.experience || []).map((e) => ({ roles: e.roles, years: e.years, have: yearsIn(p, e.roles) })).filter((e) => e.have + 1e-9 < e.years);
  return { ok: !qualifications.length && !experience.length, qualifications, experience };
}

/**
 * Whether a person can take a role now, and on each route what is missing (the route with least
 * missing first).
 */
export function roleStatus(cat, p, roleId) {
  const role = cat.roles.find((r) => r.id === roleId);
  const a = role?.access;
  if (!a) return { ok: false, job: false, routes: [], age: true };
  const age = ageOf(p) >= (a.age_min || 0);
  const routes = (a.routes || []).map((route, i) => ({ i, route, ...routeStatus(p, route) }))
    .sort((x, y) => (x.qualifications.length + x.experience.length) - (y.qualifications.length + y.experience.length));
  return { ok: a.job && age && routes.some((r) => r.ok) && p.current !== roleId, job: a.job, age, routes };
}

/**
 * What is open now: the jobs a person can take, the educations they can start, and whether they can
 * work on in their role.
 */
export function options(cat, p) {
  const jobs = cat.roles.filter((r) => r.access?.job && roleStatus(cat, p, r.id).ok).map((r) => r.id);
  const educations = (cat.qualifications || []).filter((q) => q.kind !== "school" && canStart(cat, p, q.id)).map((q) => q.id);
  return { jobs, educations, work: !!p.current };
}

/** Months pass in the current role (if any); after a year in a role, what it gains. */
function pass(cat, p, months) {
  if (p.current) {
    const before = p.months_in.get(p.current) || 0;
    p.months_in.set(p.current, before + months);
    if (before < 12 && before + months >= 12) {
      const role = cat.roles.find((r) => r.id === p.current);
      for (const g of role?.access?.gains || []) {
        if (p.qualifications.has(g)) continue;
        p.qualifications.set(g, p.months + (12 - before));
        note(p, "gain", g, `Gains the ${qualificationsOf(cat).get(g)?.name ?? g} in the role`);
      }
    }
  }
  p.months += months;
}

/**
 * Take a role whose requirements are met.
 * @returns {{ok: boolean, reason?: string}}
 */
export function takeRole(cat, p, roleId) {
  const st = roleStatus(cat, p, roleId);
  const role = cat.roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, reason: "There is no such role." };
  if (!st.job) return { ok: false, reason: `${role.name} is not a job.` };
  if (!st.routes.some((r) => r.ok)) return { ok: false, reason: `Not yet: ${missingText(cat, st.routes[0])}.` };
  if (!st.age) return { ok: false, reason: `${role.name} needs an age of at least ${role.access.age_min}.` };
  if (!st.ok) return { ok: false, reason: `${role.name} is your role already.` };
  const how = { application: "Applies and becomes", internal: "Moves on to", election: "Is elected", appointment: "Is appointed", none: "Becomes" }[role.access.selection] ?? "Becomes";
  p.current = roleId;
  note(p, "role", roleId, `${how}: ${role.name}`);
  return { ok: true };
}

/**
 * Start (and complete) an education. One that cannot be done alongside a job means leaving the
 * current role for its time; one that can be keeps the role and its experience growing.
 * @returns {{ok: boolean, reason?: string}}
 */
export function study(cat, p, qid) {
  const q = qualificationsOf(cat).get(qid);
  if (!q) return { ok: false, reason: "There is no such qualification." };
  if (p.qualifications.has(qid)) return { ok: false, reason: `Already holds the ${q.name}.` };
  if (!canStart(cat, p, qid)) return { ok: false, reason: `The ${q.name} needs first: ${(q.requires || []).map((s) => s.map((x) => qualificationsOf(cat).get(x)?.name ?? x).join(" and ")).join(", or ")}.` };
  if (!q.while_working && p.current) {
    note(p, "leave", p.current, `Leaves the role for the ${q.name}`);
    p.current = null;
  }
  pass(cat, p, q.months || 0);
  p.qualifications.set(qid, p.months);
  note(p, "qualification", qid, `${q.kind === "degree" ? "Graduates" : q.kind === "licence" || q.kind === "certificate" || q.kind === "exam" ? "Obtains" : "Completes"}: ${q.name} (${q.months || 0} months)`);
  return { ok: true };
}

/** Work on in the current role for some years. */
export function work(cat, p, years = 1) {
  if (!p.current) return { ok: false, reason: "No role to work in." };
  pass(cat, p, Math.round(years * 12));
  note(p, "work", p.current, `${years} year${years === 1 ? "" : "s"} in the role`);
  return { ok: true };
}

/** What is missing on a route, in words. */
export function missingText(cat, st) {
  if (!st) return "no way in is known";
  const qs = qualificationsOf(cat), roles = new Map(cat.roles.map((r) => [r.id, r]));
  const parts = [
    ...st.qualifications.map((q) => qs.get(q)?.name ?? q),
    ...st.experience.map((e) => `${e.years} years as ${e.roles.map((r) => roles.get(r)?.name ?? r).join(" or ")}${e.have ? ` (${Math.round(e.have * 10) / 10} so far)` : ""}`),
  ];
  return parts.join(", ") || "nothing";
}

/**
 * The qualifications needed before a qualification, as a tree: each alternative with its own
 * prerequisites (cut where a qualification repeats).
 * @returns {{id: string, alternatives: Array<Array<object>>}}
 */
export function prerequisiteTree(cat, qid, seen = new Set()) {
  const q = qualificationsOf(cat).get(qid);
  if (!q || seen.has(qid)) return { id: qid, alternatives: [] };
  const next = new Set([...seen, qid]);
  return { id: qid, alternatives: (q.requires || []).filter((s) => s.length).map((s) => s.map((x) => prerequisiteTree(cat, x, next))) };
}

/**
 * Everything reachable from the school certificates with time enough: qualifications and roles. Used
 * to check a catalogue (every job must be reachable).
 * @returns {{qualifications: Set<string>, roles: Set<string>}}
 */
export function reachable(cat) {
  const qs = new Set(startPoints(cat).map((s) => s.id)), roles = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const q of cat.qualifications || []) {
      if (qs.has(q.id)) continue;
      const alts = (q.requires || []).filter((s) => s.length);
      if (!alts.length || alts.some((s) => s.every((x) => qs.has(x)))) {
        qs.add(q.id);
        changed = true;
      }
    }
    for (const r of cat.roles) {
      if (roles.has(r.id) || !r.access?.job) continue;
      if ((r.access.routes || []).some((rt) => (rt.qualifications || []).every((x) => qs.has(x)) && (rt.experience || []).every((e) => e.roles.some((x) => roles.has(x))))) {
        roles.add(r.id);
        for (const g of r.access.gains || []) qs.add(g);
        changed = true;
      }
    }
  }
  return { qualifications: qs, roles };
}
