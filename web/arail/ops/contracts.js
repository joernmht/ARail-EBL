/**
 * Contracts and penalties (Pönalen): who pays whom when operations go wrong.
 *
 * Every incident has a cause; the cause belongs to a function, and the function to a party:
 *
 * | Causes | Function | Party |
 * | --- | --- | --- |
 * | crew, commute, sick, rest, primary, capacity, fleet | operations | the operator (railway undertaking) |
 * | failure, defect | ECM management (function 1) | `ecm.management` |
 * | overrun, repeat | maintenance delivery (function 4) | `ecm.delivery` |
 * | release, planning, overdue | fleet maintenance management (function 3) | `ecm.planning` |
 * | extension | maintenance development (function 2) | `ecm.development` |
 * | infrastructure, external | nobody (often exempt) | – |
 *
 * The transport contract (operator → authority) prices what the passengers notice: cancelled
 * train-km, late trains, trains too short, comfort defects, trains without a conductor. The
 * operator then claims from the party responsible, along the chain of contracts between them
 * (operator ← ECM ← workshop): each contract passes on `pass_through` of what its payee paid for
 * the incident, plus its own items (`missing_unit`, `hard_failure`, `late_release_h`,
 * `repeat_failure`). When one party has several roles nothing changes hands between them.
 * @module arail/ops/contracts
 */

/** The function each cause belongs to. */
export const CAUSE_FUNCTION = {
  crew: "operator", commute: "operator", sick: "operator", rest: "operator", primary: "operator", capacity: "operator", fleet: "operator",
  failure: "management", defect: "management",
  overrun: "delivery", repeat: "delivery",
  release: "planning", planning: "planning", overdue: "planning",
  extension: "development",
  infrastructure: null, external: null,
};

/** Words for the causes (panel, reports). */
export const CAUSE_LABELS = {
  crew: "no crew", commute: "crew late to work", sick: "crew off sick", rest: "crew rest time", primary: "operational delay",
  capacity: "platform occupied", fleet: "too few units", failure: "unit failure", defect: "unit defect", overrun: "workshop late",
  repeat: "repeat failure after workshop", release: "release not passed on", planning: "maintenance planning", overdue: "maintenance overdue",
  extension: "no interval extension", infrastructure: "infrastructure", external: "external",
};

/** Words for the ECM functions. */
export const FUNCTION_LABELS = {
  operator: "Operations", management: "ECM management (1)", development: "Maintenance development (2)",
  planning: "Fleet maintenance management (3)", delivery: "Maintenance delivery (4)",
};

/** Incident types priced by the transport contract with the authority. */
const AUTHORITY_TYPES = new Set(["cancel", "late", "short", "comfort", "no_conductor"]);

export class Ledger {
  /** @param {object} model normalized settings */
  constructor(model) {
    this.model = model;
    this.operator = model.operator;
    this.parties = new Map(model.parties.map((p) => [p.id, p]));
    /** @type {Array<{t: number, contract: string, payer: string, payee: string, amount: number, type: string, cause: string, ref: string}>} */
    this.entries = [];
    this.totals = new Map();
    this._paths = new Map();
  }

  /** The party responsible for a cause, or null (nobody). */
  responsible(cause) {
    const fn = cause in CAUSE_FUNCTION ? CAUSE_FUNCTION[cause] : "operator";
    if (!fn) return null;
    return fn === "operator" ? this.operator : this.model.ecm[fn] ?? this.operator;
  }

  /** The transport contract: operator → authority. */
  authorityContract() {
    return this.model.contracts.find((c) => c.payer === this.operator && this.parties.get(c.payee)?.role === "authority") ?? null;
  }

  /** Contracts from the operator down to a party (each one's payer is the next one's payee), or [] if there is none. */
  path(party) {
    if (this._paths.has(party)) return this._paths.get(party);
    const prev = new Map([[this.operator, null]]);
    const queue = [this.operator];
    while (queue.length) {
      const at = queue.shift();
      if (at === party) break;
      for (const c of this.model.contracts) {
        if (c.payee !== at || prev.has(c.payer)) continue;
        prev.set(c.payer, c);
        queue.push(c.payer);
      }
    }
    const path = [];
    if (prev.has(party)) for (let p = party; prev.get(p); p = prev.get(p).payee) path.unshift(prev.get(p));
    this._paths.set(party, path);
    return path;
  }

  /**
   * Book an incident.
   * @param {{t: number, type: string, cause: string, ref?: string, km?: number, minutes?: number, hours?: number, units?: number}} inc
   *   type: cancel (km), late (minutes), short (km × units), comfort (unit-days), no_conductor, missing_unit (units),
   *   hard_failure, late_release (hours), repeat_failure
   * @returns {number} what the operator paid the authority
   */
  book(inc) {
    let carry = 0;
    const auth = this.authorityContract();
    if (auth && AUTHORITY_TYPES.has(inc.type) && !auth.exempt.includes(inc.cause) && !auth.exempt.includes(CAUSE_FUNCTION[inc.cause] ?? "")) {
      carry = this._pay(auth, authorityAmount(auth.penalties, inc), inc);
    }
    const party = this.responsible(inc.cause);
    if (!party || party === this.operator) return carry;
    const paid = carry;
    for (const c of this.path(party)) carry = this._pay(c, (c.penalties.pass_through || 0) * carry + itemAmount(c.penalties, inc), inc);
    return paid;
  }

  _pay(contract, amount, inc) {
    if (!(amount > 0)) return 0;
    const e = { t: inc.t, contract: contract.id, payer: contract.payer, payee: contract.payee, amount, type: inc.type, cause: inc.cause, ref: inc.ref ?? "" };
    this.entries.push(e);
    if (this.entries.length > 5000) this.entries.splice(0, 1000);
    const key = `${contract.id}|${inc.type}|${inc.cause}`;
    this.totals.set(key, (this.totals.get(key) || 0) + amount);
    this.onEntry?.(e);
    return amount;
  }
}

/** What the authority charges for an incident. */
function authorityAmount(p, inc) {
  switch (inc.type) {
    case "cancel": return (p.cancelled_km || 0) * (inc.km || 0);
    case "late": return inc.minutes >= (p.late_threshold_min ?? 5) ? (p.late_trip || 0) + (p.late_min || 0) * (inc.minutes - (p.late_threshold_min ?? 5)) : 0;
    case "short": return (p.short_km || 0) * (inc.km || 0) * (inc.units || 1);
    case "comfort": return (p.comfort_day || 0) * (inc.units || 1);
    case "no_conductor": return p.no_conductor_trip || 0;
    default: return 0;
  }
}

/** A contract's own item for an incident. */
function itemAmount(p, inc) {
  switch (inc.type) {
    case "missing_unit": return (p.missing_unit || 0) * (inc.units || 1);
    case "hard_failure": return p.hard_failure || 0;
    case "late_release": return (p.late_release_h || 0) * (inc.hours || 0);
    case "repeat_failure": return p.repeat_failure || 0;
    default: return 0;
  }
}
