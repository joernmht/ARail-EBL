// The role catalogue page: the roles of roles.json as cards with their details (decisions, effects,
// means, limits, risks, the ways in with their qualifications and experience, typical moves, measures,
// rhythm, the roles they work with, the mini game), the families to filter by, and a search. The
// career planner (../career/) takes a role from here as its aim.
import { ROLE_SETTINGS, qualificationsOf, roleCounts } from "../../arail/index.js";
import { $, h, mount } from "../../app/ui.js";

const SETTING_LABELS = { operational: "operational", field: "in the field", office: "in the office", mixed: "mixed" };
const KIND_LABELS = { knowledge: "knowledge", simulation: "simulation", both: "knowledge and simulation" };

class RolesPage {
  /** @param {{families: Array<{id: string, name: string}>, roles: object[]}} cat */
  constructor(cat) {
    this.cat = cat;
    this.byId = new Map(cat.roles.map((r) => [r.id, r]));
    this.family = new Map(cat.families.map((f) => [f.id, f]));
    this.quals = qualificationsOf(cat);
    this.filters();
    this.render();
    // a role named in the address: open it
    const id = decodeURIComponent(location.hash.replace(/^#role-/, ""));
    if (this.byId.has(id)) this.show(id);
  }

  filters() {
    const counts = roleCounts(this.cat);
    $("#roleCount").textContent = `${this.cat.roles.length} roles in ${this.cat.families.length} families`;
    mount($("#families"), this.cat.families.map((f) => h("button", { class: "btn", type: "button", "aria-pressed": "false", "data-family": f.id, onclick: () => this.pickFamily(f.id) },
      h("span", { class: "n" }, String(counts.family.get(f.id) || 0)), h("span", {}, f.name))));
    mount($("#family"), h("option", { value: "" }, "All families"), this.cat.families.map((f) => h("option", { value: f.id }, f.name)));
    mount($("#setting"), h("option", { value: "" }, "Anywhere"), ROLE_SETTINGS.map((s) => h("option", { value: s }, `${SETTING_LABELS[s]} (${counts.setting.get(s) || 0})`)));
    mount($("#kind"), h("option", { value: "" }, "Any kind"), Object.entries(KIND_LABELS).map(([k, l]) => h("option", { value: k }, `${l} (${counts.kind.get(k) || 0})`)));
    for (const id of ["#q", "#family", "#setting", "#kind"]) $(id).addEventListener("input", () => this.render());
    $("#filters").addEventListener("submit", (e) => e.preventDefault());
  }

  pickFamily(id) {
    $("#family").value = $("#family").value === id ? "" : id;
    this.render();
  }

  /** The roles that the filters let through. */
  shown() {
    const q = $("#q").value.trim().toLowerCase(), fam = $("#family").value, set = $("#setting").value, kind = $("#kind").value;
    return this.cat.roles.filter((r) => (!fam || r.family === fam) && (!set || r.setting === set) && (!kind || r.game?.kind === kind)
      && (!q || [r.name, r.name_de, r.organisation, r.summary, r.game?.title, ...(r.decisions || [])].join(" ").toLowerCase().includes(q)));
  }

  render() {
    const list = this.shown();
    for (const b of $("#families").children) b.setAttribute("aria-pressed", b.dataset.family === $("#family").value ? "true" : "false");
    $("#count").textContent = list.length === this.cat.roles.length ? `All ${list.length} roles.` : `${list.length} of ${this.cat.roles.length} roles.`;
    mount($("#roles"), list.map((r) => this.card(r)));
  }

  /** A link to another role of the catalogue. */
  link(id) {
    const r = this.byId.get(id);
    return h("a", { href: `#role-${id}`, onclick: (e) => { e.preventDefault(); this.show(id); } }, r ? r.name : id);
  }

  card(r) {
    const g = r.game || {};
    const list = (items) => h("ul", {}, items.map((x) => h("li", {}, x)));
    const links = (ids) => ids?.length ? h("span", { class: "links" }, ids.map((id) => this.link(id))) : "–";
    return h("article", { class: "game-card role-card", id: `role-${r.id}`, "aria-labelledby": `name-${r.id}` },
      h("h3", { id: `name-${r.id}` }, r.name),
      h("p", { class: "de", lang: "de" }, r.name_de),
      h("p", { class: "org" }, `${this.family.get(r.family)?.name ?? r.family} · ${r.organisation}`),
      h("p", { class: "tags" }, h("span", { class: "tag" }, SETTING_LABELS[r.setting] ?? r.setting)),
      h("p", { class: "hint" }, `Rhythm: ${r.timescale}`),
      h("p", {}, r.summary),
      h("div", { class: "game" },
        h("strong", {}, `Mini game: ${g.title}`),
        h("span", { class: "hint" }, `${KIND_LABELS[g.kind] ?? g.kind} · effort ${g.effort}`),
        g.page ? h("p", {}, h("a", { class: "btn small primary", href: `../${g.page}` }, "Play it")) : null),
      h("details", {},
        h("summary", {}, "Decisions, means, risks, career, the game"),
        h("dl", {},
          h("div", {}, h("dt", {}, "Decides"), h("dd", {}, list(r.decisions))),
          h("div", {}, h("dt", {}, "Effects"), h("dd", {}, list(r.effects))),
          h("div", {}, h("dt", {}, "Means and budgets"), h("dd", {}, list(r.resources))),
          h("div", {}, h("dt", {}, "Rules and limits"), h("dd", {}, list(r.limits))),
          h("div", {}, h("dt", {}, "Personal risks"), h("dd", {}, list(r.risks))),
          h("div", {}, h("dt", {}, "Measured by"), h("dd", {}, list(r.kpis))),
          h("div", {}, h("dt", {}, "How one becomes it"), h("dd", {}, r.career?.entry)),
          r.access?.job ? h("div", {}, h("dt", {}, "Ways in"), h("dd", {}, this.ways(r), h("p", {}, h("a", { href: `../career/#aim=${r.id}` }, "Aim for this role in the career planner")))) : null,
          h("div", {}, h("dt", {}, "Often comes from"), h("dd", {}, links(r.career?.from))),
          h("div", {}, h("dt", {}, "Often leads to"), h("dd", {}, links(r.career?.to))),
          h("div", {}, h("dt", {}, "Career chances and pay"), h("dd", {}, r.career?.chances)),
          h("div", {}, h("dt", {}, "Works with"), h("dd", {}, links(r.interacts))),
          h("div", {}, h("dt", {}, "The game"), h("dd", {}, h("p", {}, g.loop), h("p", {}, h("strong", {}, "Success: "), g.win), h("p", {}, h("strong", {}, "Knowledge: "), g.knowledge), h("p", {}, h("strong", {}, "In the big game: "), g.bigGame), h("p", {}, h("strong", {}, "Builds on: "), (g.arail || []).join(", ")))),
        )),
    );
  }

  /** A role's ways in: each route's qualifications and experience. */
  ways(r) {
    const a = r.access, q = (id) => this.quals.get(id)?.name ?? id;
    return h("div", {},
      h("p", { class: "hint" }, [{ application: "By application", internal: "Within the organisation", election: "By election", appointment: "By appointment", none: "Anyone" }[a.selection], a.age_min ? `from age ${a.age_min}` : null, a.fitness || null].filter(Boolean).join(" · ")),
      h("ul", {}, (a.routes || []).map((rt) => h("li", {}, h("strong", {}, `${rt.label}: `),
        [...(rt.qualifications || []).map(q), ...(rt.experience || []).map((e) => `${e.years} years as ${e.roles.map((x) => this.byId.get(x)?.name ?? x).join(" or ")}`)].join(", ") || "no formal requirement"))));
  }

  /** Show one role: clear filters that hide it, open its details, scroll to it. */
  show(id) {
    const r = this.byId.get(id);
    if (!r) return;
    if (!this.shown().includes(r)) {
      for (const f of ["#q", "#family", "#setting", "#kind"]) $(f).value = "";
      this.render();
    }
    const el = document.getElementById(`role-${id}`);
    el.querySelector("details").open = true;
    history.replaceState(null, "", `#role-${id}`);
    el.scrollIntoView({ block: "start" });
    el.querySelector("h3").setAttribute("tabindex", "-1");
    el.querySelector("h3").focus({ preventScroll: true });
  }
}

fetch("roles.json")
  .then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  })
  .then((cat) => {
    window.__roles = new RolesPage(cat);
  })
  .catch((e) => mount($("#roles"), h("p", { class: "hint" }, `The catalogue could not be loaded (${e.message}).`)));
