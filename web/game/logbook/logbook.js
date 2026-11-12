// The logbook of the game (game/logbook/): what a player has reached, read from the progress kept in
// the browser (progress.js). The rank the stars add up to and what the next one needs; the missions
// on their line with stars and best scores; the badges; the railway terms met, as cards to turn, with
// a quiz; the places worked at, as pictures; and a sheet for every mission played (what was decided,
// the terms met, the questions of the debrief), to print. Nothing leaves the browser.
import { $, h, mount, storage } from "../../app/ui.js";
import { TERMS, termOf } from "../glossary.js";
import { placeOfMission } from "../places.js";
import { BADGES, MAX_STARS, PROGRESS_KEY, RANKS, badgesOf, emptyProgress, rankOf, readProgress, totalStars } from "../progress.js";

const MISSIONS = "../missions/", BASE = "../../";
/** How many terms a quiz question offers. */
const QUIZ_OPTIONS = 4;

/** Stars as they are shown: filled and empty, with their number for who does not see them. */
function stars(n, most = MAX_STARS) {
  return h("span", { class: "stars" }, h("span", { "aria-hidden": "true" }, "★".repeat(n), h("i", {}, "★".repeat(most - n))), h("span", { class: "visually-hidden" }, `${n} of ${most} stars`));
}

/** A list in another order (for the quiz; nothing here needs to be played again). */
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class LogbookPage {
  constructor() {
    /** What the player has reached (progress.js). */
    this.progress = readProgress(storage.get(PROGRESS_KEY, null));
    /** The missions' documents in their order, and the roles' names by id. */
    this.missions = [];
    this.roles = new Map();
    /** The terms whose cards are turned (their ids). */
    this.turned = new Set();
    /** The quiz: the term asked, the terms offered, the answer given, and how many were right in a row. */
    this.quiz = null;
    this.streak = 0;
    this.ready = false;
    $("#quizBtn").onclick = () => this.ask();
    $("#resetBtn").onclick = () => $("#resetDialog").showModal();
    $("#resetNo").onclick = () => $("#resetDialog").close();
    $("#resetYes").onclick = () => this.reset();
    addEventListener("afterprint", () => document.querySelector(".log-sheet.printing")?.classList.remove("printing"));
    this.draw();
    this.loaded = this.load();
  }

  /** Load the missions and the roles' names, then show what the address names (a sheet). */
  async load() {
    const json = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    };
    try {
      const [list, cat] = await Promise.all([json(`${MISSIONS}missions.json`), json("../roles/roles.json").catch(() => null)]);
      for (const r of cat?.roles ?? []) this.roles.set(r.id, r.name);
      this.missions = (await Promise.all((list.missions ?? []).map((file) => json(MISSIONS + file).catch(() => null)))).filter((d) => d?.id);
    } catch {
      this.missions = [];
    }
    this.ready = true;
    this.draw();
    let id = "";
    try {
      id = location.hash.startsWith("#sheet-") ? decodeURIComponent(location.hash.slice(1)) : "";
    } catch {
      // an address that cannot be read names no sheet
    }
    const at = id ? document.getElementById(id) : null;
    if (at) {
      at.scrollIntoView({ block: "start" });
      at.querySelector("h3")?.focus();
    }
  }

  /** Say something to those who do not see the page. */
  say(text) {
    $("#live").textContent = text;
  }

  /** Draw the whole page from the progress. */
  draw() {
    this.rank();
    this.line();
    this.badges();
    this.terms();
    this.places();
    this.sheets();
  }

  /** The rank: its name, the stars, what the next one needs, and the ladder of ranks. */
  rank() {
    const p = this.progress, n = totalStars(p), r = rankOf(n);
    const passed = Object.values(p.missions).filter((m) => m.passed).length, from = RANKS[r.index].stars, to = RANKS[r.index + 1]?.stars ?? from;
    mount($("#rank"),
      h("p", { class: "eyebrow" }, "Your logbook"),
      h("h1", { id: "rankTitle" }, r.title),
      h("p", { class: "log-count" },
        h("span", {}, h("strong", {}, String(n)), n === 1 ? " star" : " stars"),
        h("span", {}, h("strong", {}, String(passed)), this.missions.length ? ` of ${this.missions.length} missions passed` : " missions passed"),
        h("span", {}, h("strong", {}, String(p.terms.length)), ` of ${TERMS.length} railway terms`),
        h("span", {}, h("strong", {}, String(badgesOf(p, this.missions.map((m) => m.id)).length)), ` of ${BADGES.length} badges`)),
      r.next ? [
        h("p", { class: "log-next" }, `${r.need === 1 ? "1 more star" : `${r.need} more stars`} to `, h("strong", {}, r.next)),
        h("div", { class: "log-meter", role: "progressbar", "aria-label": `On the way to ${r.next}`, "aria-valuemin": String(from), "aria-valuemax": String(to), "aria-valuenow": String(n) }, h("i", { style: { width: `${Math.round((100 * (n - from)) / Math.max(1, to - from))}%` } })),
      ] : h("p", { class: "log-next" }, "The highest rank. The railway is yours."),
      h("ol", { class: "log-ranks", "aria-label": "The ranks" }, RANKS.map((x, i) => h("li", { class: i < r.index ? "had" : i === r.index ? "now" : "", "aria-current": i === r.index ? "true" : null }, x.title, h("small", {}, ` ${x.stars}★`)))),
      !n && !Object.keys(p.missions).length ? h("p", {}, h("a", { class: "btn primary log-big", href: "../play/" }, "Play your first shift")) : h("p", {}, h("a", { class: "btn primary", href: "../play/" }, "To the missions")));
  }

  /** The missions on their line: number, name, stars, the best score, how often played; to play it, to its sheet. */
  line() {
    const p = this.progress;
    mount($("#line"), this.ready && !this.missions.length ? h("li", { class: "hint" }, "The missions could not be loaded.") : this.missions.map((doc, i) => {
      const got = p.missions[doc.id];
      return h("li", { class: got?.passed ? "done" : got ? "tried" : "" },
        h("span", { class: "no" }, String(i + 1).padStart(2, "0")),
        h("span", { class: "name" }, doc.title),
        stars(got?.stars ?? 0),
        h("span", { class: "best" }, got ? `best ${got.best} · played ${got.plays === 1 ? "once" : `${got.plays} times`}` : "not played yet"),
        h("span", { class: "go" },
          p.sheets[doc.id] ? h("a", { class: "btn small", href: `#sheet-${doc.id}` }, "Sheet") : null,
          h("a", { class: "btn small", href: `../play/?mission=${encodeURIComponent(doc.id)}`, "aria-label": `Play ${doc.title}` }, "Play")));
    }));
  }

  /** The badges: the earned ones lit, the others with how they are earned. */
  badges() {
    const earned = badgesOf(this.progress, this.missions.map((m) => m.id));
    mount($("#badges"), BADGES.map((b) => {
      const on = earned.includes(b.id);
      return h("li", { class: on ? "on" : "" }, h("span", { class: "medal", "aria-hidden": "true" }, on ? "★" : "?"), h("strong", {}, b.title), h("span", {}, on ? "Earned. " : "", b.how));
    }));
  }

  /** The railway terms: those met as cards to turn (the term, then what it is), the others still closed. */
  terms() {
    const met = new Set(this.progress.terms);
    $("#termsNote").textContent = met.size ? `${met.size} of ${TERMS.length} met. Tap a card to turn it. A term is met when a mission shows it.` : `None of ${TERMS.length} met yet. A term is met when a mission shows it.`;
    $("#quizBtn").hidden = met.size < QUIZ_OPTIONS;
    const closed = TERMS.length - met.size;
    mount($("#terms"), TERMS.filter((t) => met.has(t.id)).map((t) => {
      const on = this.turned.has(t.id);
      return h("li", {}, h("button", { class: `log-term${on ? " turned" : ""}`, type: "button", "data-term": t.id, "aria-expanded": String(on), onclick: () => this.turn(t.id) },
        on ? h("span", { class: "back" }, t.line) : [h("strong", {}, t.term), t.de ? h("span", { class: "de", lang: "de" }, t.de) : null]));
    }), closed ? h("li", { class: "closed" }, h("span", { class: "log-term" }, h("span", { class: "q", "aria-hidden": "true" }, `+${closed}`), h("span", {}, closed === 1 ? "term still to meet" : "terms still to meet"))) : null);
  }

  /** Turn a term's card. */
  turn(id) {
    this.turned[this.turned.has(id) ? "delete" : "add"](id);
    this.terms();
    document.querySelector(`#terms [data-term="${id}"]`)?.focus();
  }

  /** A quiz question: what one of the terms met is, and a few terms to choose from. */
  ask() {
    const met = TERMS.filter((t) => this.progress.terms.includes(t.id));
    if (met.length < QUIZ_OPTIONS) return;
    const term = shuffled(met.filter((t) => t.id !== this.quiz?.term.id))[0];
    this.quiz = { term, options: shuffled([term, ...shuffled(met.filter((t) => t !== term)).slice(0, QUIZ_OPTIONS - 1)]), answer: null };
    this.drawQuiz();
    $("#quiz").querySelector("button")?.focus();
  }

  /** Answer the quiz question. */
  answer(id) {
    const q = this.quiz;
    if (!q || q.answer) return;
    q.answer = id;
    const right = id === q.term.id;
    this.streak = right ? this.streak + 1 : 0;
    this.say(right ? `Right: ${q.term.term}.` : `Not quite: it is ${q.term.term}.`);
    this.drawQuiz();
    $("#quizNext")?.focus();
  }

  /** The quiz: the line of a term without its name, the terms offered, and after an answer whether it was right. */
  drawQuiz() {
    const q = this.quiz, el = $("#quiz");
    el.hidden = !q;
    if (!q) return void mount(el);
    // the line without the term's own words, so that it does not give itself away
    const line = q.term.line.replace(q.term.find, "…");
    mount(el,
      h("p", { class: "log-quiz-q" }, h("span", { class: "eyebrow" }, "Which term is it?"), line),
      h("div", { class: "log-quiz-options" }, q.options.map((t) => h("button", {
        class: `btn${q.answer && t === q.term ? " right" : q.answer === t.id ? " wrong" : ""}`, type: "button", "aria-disabled": q.answer ? "true" : null, onclick: () => this.answer(t.id),
      }, t.term))),
      q.answer ? h("p", { class: "log-quiz-a" }, q.answer === q.term.id ? "Right. " : `Not quite: it is ${q.term.term}. `, this.streak > 1 ? h("strong", {}, `${this.streak} in a row.`) : null) : null,
      h("div", { class: "row" },
        q.answer ? h("button", { class: "btn primary", type: "button", id: "quizNext", onclick: () => this.ask() }, "Next question") : null,
        h("button", { class: "btn", type: "button", onclick: () => { this.quiz = null; this.drawQuiz(); $("#quizBtn").focus(); } }, "Close the quiz")));
  }

  /** The places of the missions, as pictures: those worked at, and those still to come. */
  places() {
    const seen = new Map();
    for (const doc of this.missions) {
      const place = placeOfMission(doc), was = seen.get(place.id);
      seen.set(place.id, { place, been: (was?.been ?? false) || !!this.progress.missions[doc.id] });
    }
    mount($("#places"), [...seen.values()].map(({ place, been }) => h("li", { class: been ? "been" : "" },
      h("img", { src: BASE + place.photo, alt: been ? place.alt : "", loading: "lazy", decoding: "async", style: `object-position: ${place.focus ?? "50% 50%"}` }),
      h("span", {}, been ? place.name : "Not been there yet"))));
  }

  /** A sheet per mission played: the score, the roles sat in, what was decided, the terms met, the debrief's questions. */
  sheets() {
    const p = this.progress, list = this.missions.filter((doc) => p.sheets[doc.id]);
    $("#sheetsNote").hidden = list.length > 0;
    mount($("#sheets"), list.map((doc) => {
      const s = p.sheets[doc.id], rounds = [...new Set(s.decisions.map((d) => d.round))];
      const terms = s.terms.map(termOf).filter(Boolean);
      return h("article", { class: "log-card log-sheet", id: `sheet-${doc.id}`, "aria-labelledby": `sheet-title-${doc.id}` },
        h("p", { class: "eyebrow" }, "Sheet"),
        h("h3", { id: `sheet-title-${doc.id}`, tabindex: "-1" }, doc.title),
        h("p", { class: "log-sheet-score" }, stars(s.stars), h("strong", {}, ` ${s.score} of 100`), s.passed ? " · passed" : " · not passed",
          s.danger ? " · a danger to people" : s.violations ? ` · ${s.violations === 1 ? "1 rule broken" : `${s.violations} rules broken`}` : " · no rule broken"),
        h("p", {}, "You were: ", h("strong", {}, s.roles.map((id) => this.roles.get(id) ?? id).join(", ") || "nobody"), "."),
        doc.hook ? h("p", { class: "hint" }, doc.hook) : null,
        h("h4", {}, "What you decided"),
        s.decisions.length ? rounds.map((round) => [
          rounds.length > 1 ? h("p", { class: "log-round" }, `Round ${round}`) : null,
          h("ol", { class: "log-decisions" }, s.decisions.filter((d) => d.round === round).map((d) => h("li", {}, h("span", {}, d.title), h("strong", {}, d.chose)))),
        ]) : h("p", { class: "hint" }, "No decision was asked of you: you worked on the picture."),
        terms.length ? [h("h4", {}, "The terms you met"), h("dl", { class: "log-dl" }, terms.map((t) => [h("dt", {}, t.term, t.de ? [" ", h("span", { class: "de", lang: "de" }, `(${t.de})`)] : null), h("dd", {}, t.line)]))] : null,
        doc.debrief?.length ? [h("h4", {}, "To think about"), h("ol", { class: "log-debrief" }, doc.debrief.map((q) => h("li", {}, q)))] : null,
        h("div", { class: "row log-sheet-tools" },
          h("button", { class: "btn", type: "button", onclick: (e) => this.print(e.target.closest(".log-sheet")) }, "Print this sheet"),
          h("a", { class: "btn", href: `../play/?mission=${encodeURIComponent(doc.id)}` }, "Play it again")));
    }));
  }

  /** Print one sheet: only it goes to the paper. */
  print(sheet) {
    for (const el of document.querySelectorAll(".log-sheet.printing")) el.classList.remove("printing");
    sheet.classList.add("printing");
    print();
  }

  /** Empty the logbook. */
  reset() {
    storage.remove(PROGRESS_KEY);
    this.progress = emptyProgress();
    this.turned.clear();
    this.quiz = null;
    this.streak = 0;
    $("#resetDialog").close();
    this.drawQuiz();
    this.draw();
    this.say("Your logbook is empty.");
    $("#rankTitle").focus?.();
  }
}

window.__logbook = new LogbookPage();
