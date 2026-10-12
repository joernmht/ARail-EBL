// The career planner: a person from a school certificate through the roles of the role catalogue
// (roles.json, arail/game/career.js). At every point it shows what is open (jobs whose requirements
// are met, educations whose prerequisites are held, working on), the role aimed at with what is
// missing on each way in, and the career so far. Nothing is laid out in advance: the player chooses.
import { ageOf, careerOptions, createCareer, missingText, qualificationsOf, roleStatus, startPoints, study, takeRole, work } from "../../arail/index.js";
import { $, h, mount, morph, storage } from "../../app/ui.js";

const KIND_LABELS = { school: "school", apprenticeship: "apprenticeship", degree: "degree", training: "training", licence: "licence", certificate: "certificate", exam: "exam" };
const SELECTION_LABELS = { application: "by application", internal: "within the organisation", election: "by election", appointment: "by appointment", none: "anyone" };
const KEY = "arail.career";

/** A career as JSON and back (its Maps as lists). */
const save = (p) => ({ ...p, qualifications: [...p.qualifications], months_in: [...p.months_in] });
const load = (o) => ({ ...o, qualifications: new Map(o.qualifications), months_in: new Map(o.months_in) });

class CareerPage {
  constructor(cat) {
    this.cat = cat;
    this.quals = qualificationsOf(cat);
    this.roles = new Map(cat.roles.map((r) => [r.id, r]));
    this.family = new Map(cat.families.map((f) => [f.id, f.name]));
    this.history = [];
    const starts = startPoints(cat);
    if (!starts.length) throw new Error("this catalogue has no careers yet (no qualifications)");
    mount($("#start"), starts.map((s) => h("option", { value: s.id }, `${s.name} (${s.name_de}), age ${s.age}`)));
    $("#startBtn").onclick = () => this.start($("#start").value);
    $("#undoBtn").onclick = () => this.undo();
    mount($("#aim"), h("option", { value: "" }, "Choose a role"), cat.families.map((f) => h("optgroup", { label: f.name },
      cat.roles.filter((r) => r.family === f.id && r.access?.job).map((r) => h("option", { value: r.id }, r.name)))));
    $("#aim").onchange = () => {
      this.aim = $("#aim").value || null;
      this.render();
    };
    // the address: #aim=<role> from the roles page
    const m = location.hash.match(/aim=([\w-]+)/);
    if (m && this.roles.has(m[1])) {
      this.aim = m[1];
      $("#aim").value = m[1];
    }
    let saved = null;
    try {
      saved = storage.get(KEY, null);
      this.person = saved ? load(saved) : null;
    } catch {
      this.person = null;
    }
    if (!this.person) this.start(starts.find((s) => /abitur/i.test(s.id))?.id ?? starts[0].id, { quiet: true });
    else $("#start").value = this.person.start;
    this.render();
  }

  start(id, { quiet = false } = {}) {
    this.person = createCareer(this.cat, id);
    this.history = [];
    this.persist();
    if (!quiet) this.render();
  }

  persist() {
    storage.set(KEY, save(this.person));
  }

  /** Do a step, keeping the state before it for Step back. */
  step(fn) {
    const before = structuredClone(this.person);
    const res = fn();
    if (res.ok) {
      this.history.push(before);
      this.persist();
    }
    this.message = res.ok ? null : res.reason;
    this.render();
  }

  undo() {
    if (!this.history.length) return;
    this.person = this.history.pop();
    this.persist();
    this.render();
  }

  roleLink(id) {
    return h("a", { href: `../roles/#role-${id}` }, this.roles.get(id)?.name ?? id);
  }

  render() {
    const p = this.person, cat = this.cat;
    const opts = careerOptions(cat, p);
    $("#undoBtn").disabled = !this.history.length;
    // you
    const experience = [...p.months_in].filter(([, m]) => m > 0);
    morph($("#you"),
      h("dl", { class: "career-facts" },
        h("dt", {}, "Age"), h("dd", {}, `${ageOf(p)} (${Math.floor(p.months / 12)} years since school)`),
        h("dt", {}, "Now"), h("dd", {}, p.current ? this.roleLink(p.current) : "not in a role"),
        h("dt", {}, "Qualifications"), h("dd", {}, h("ul", { class: "career-chips" }, [...p.qualifications.keys()].map((q) => h("li", { class: "tag" }, this.quals.get(q)?.name ?? q)))),
        h("dt", {}, "Experience"), h("dd", {}, experience.length ? h("ul", { class: "career-chips" }, experience.map(([r, m]) => h("li", { class: "tag" }, `${this.roles.get(r)?.name ?? r}: ${Math.round((m / 12) * 10) / 10} years`))) : "none yet")),
      this.message ? h("p", { class: "career-reason", role: "alert" }, this.message) : null,
    );
    // what you can do now
    const jobs = opts.jobs.map((id) => this.roles.get(id));
    const edu = opts.educations.map((id) => this.quals.get(id)).sort((a, b) => a.months - b.months);
    morph($("#next"),
      p.current ? h("div", { class: "row" },
        h("span", {}, "Work on in your role: "),
        [1, 3].map((y) => h("button", { class: "btn small", type: "button", onclick: () => this.step(() => work(cat, p, y)) }, `+${y} year${y > 1 ? "s" : ""}`))) : null,
      h("h3", {}, `Jobs open to you (${jobs.length})`),
      jobs.length ? h("ul", { class: "career-list", "aria-label": "Jobs open to you" }, jobs.map((r) => h("li", {},
        h("span", { class: "what" }, this.roleLink(r.id), h("span", { class: "hint" }, `${this.family.get(r.family)} · ${SELECTION_LABELS[r.access.selection]}`)),
        h("button", { class: "btn small primary", type: "button", onclick: () => this.step(() => takeRole(cat, p, r.id)) }, "Take it")))) : h("p", { class: "hint" }, "No job is open yet: start an education."),
      h("h3", {}, `Educations you can start (${edu.length})`),
      h("ul", { class: "career-list", "aria-label": "Educations you can start" }, edu.map((q) => h("li", {},
        h("span", { class: "what" }, h("span", {}, q.name), h("span", { class: "hint" }, `${KIND_LABELS[q.kind]} · ${q.months} months${q.while_working ? " · alongside a job" : ""} · ${q.provider}`)),
        h("button", { class: "btn small", type: "button", onclick: () => this.step(() => study(cat, p, q.id)) }, "Start")))),
    );
    // the role aimed at
    morph($("#aimInfo"), this.aim ? this.aimView(this.aim) : h("p", { class: "hint" }, "Choose a role to see its ways in and what you still need for each."));
    // the career so far
    mount($("#log"), p.log.map((l) => h("li", {}, h("span", { class: "age" }, `${p.startAge + Math.floor(l.at / 12)}: `), l.text)));
  }

  /** A role aimed at: open now or not, each way in with what is there and what is missing. */
  aimView(id) {
    const r = this.roles.get(id), st = roleStatus(this.cat, this.person, id), a = r.access;
    const qName = (q) => this.quals.get(q)?.name ?? q;
    return h("div", {},
      h("p", {}, h("strong", {}, this.roleLink(id)), ` · ${SELECTION_LABELS[a.selection]}${a.age_min ? ` · from age ${a.age_min}` : ""}${a.fitness ? ` · ${a.fitness}` : ""}`),
      h("p", {}, st.ok ? "Open to you now." : this.person.current === id ? "Your role now." : !st.age ? `You are too young (from ${a.age_min}).` : "Not yet: one of these ways leads in."),
      st.routes.map((rt) => h("div", { class: `career-route${rt.ok ? " open" : ""}` },
        h("h4", {}, rt.route.label),
        h("ul", {},
          (rt.route.qualifications || []).map((q) => {
            const have = this.person.qualifications.has(q), qq = this.quals.get(q);
            const first = !have && qq?.requires?.some((s) => s.length) ? h("span", { class: "first" }, ` (needs first: ${qq.requires.filter((s) => s.length).map((s) => s.map(qName).join(" and ")).join(", or ")})`) : null;
            return h("li", { class: have ? "have" : "miss" }, qName(q), first);
          }),
          (rt.route.experience || []).map((e) => {
            const miss = rt.experience.find((x) => x.roles === e.roles);
            return h("li", { class: miss ? "miss" : "have" }, `${e.years} years as `, e.roles.map((x, i) => [i ? " or " : "", this.roleLink(x)]), miss?.have ? ` (${Math.round(miss.have * 10) / 10} so far)` : "");
          })),
        rt.route.note ? h("p", { class: "hint" }, rt.route.note) : null)),
      !st.ok && st.routes[0] ? h("p", { class: "hint" }, `Closest way: ${missingText(this.cat, st.routes[0])}.`) : null,
    );
  }
}

fetch("../roles/roles.json")
  .then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  })
  .then((cat) => {
    window.__career = new CareerPage(cat);
  })
  .catch((e) => mount($("#next"), h("p", { class: "hint" }, `The role catalogue could not be loaded (${e.message}).`)));
