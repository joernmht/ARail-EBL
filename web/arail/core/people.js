/**
 * People of the simulations: town residents, train crews and maintenance staff are all made here,
 * as a `Person` with an id, a name, a language, a role and a home, by a `Population` that keeps
 * their names unique and stable for a seed.
 *
 * Names are made of bird names, so nobody in the simulation is a real person. Each person gets one
 * language, and both parts of the name are birds in that language. The weights (per cent) are a
 * rough picture of the languages of the people living in Germany: German, the largest groups with
 * an immigration history (Mikrozensus), Low German (Plattdeutsch) and two of the recognised
 * national minorities (Danish, Sorbian). Names in non-Latin scripts are transliterated.
 *
 * Homes are one of `{kind: "layout", building, entrance?, name?, walkM?}` (a house on the layout),
 * `{kind: "station", station, line}` (beyond the layout, by train) and `{kind: "away", minutes}`
 * (beyond the layout, by car).
 * @module arail/core/people
 */
import { createRng, hashKey } from "./math.js";

/**
 * Bird names per language, with the weight (per cent) of the language and the particles before
 * some family names (per cent of the people: "Merel van Vink", "Amsel von Falke").
 */
export const LANGUAGES = [
  { lang: "de", weight: 68, particles: { von: 4 }, birds: [
    "Amsel", "Drossel", "Fink", "Meise", "Specht", "Sperling", "Lerche", "Elster", "Rabe", "Krähe", "Taube", "Schwalbe",
    "Star", "Storch", "Reiher", "Kranich", "Eule", "Kauz", "Falke", "Bussard", "Habicht", "Adler", "Zeisig", "Stieglitz",
    "Gimpel", "Dohle", "Kiebitz", "Wachtel", "Pirol", "Wiedehopf", "Eisvogel", "Zaunkönig", "Ammer", "Schwan", "Möwe", "Kuckuck",
  ] },
  { lang: "tr", weight: 5, birds: [
    "Serçe", "Kartal", "Şahin", "Doğan", "Turna", "Leylek", "Bülbül", "Kumru", "Güvercin", "Karga", "Baykuş", "Saksağan",
    "Kırlangıç", "Martı", "Toygar", "Atmaca",
  ] },
  { lang: "pl", weight: 4, birds: [
    "Wróbel", "Sikora", "Jaskółka", "Słowik", "Sokół", "Orzeł", "Żuraw", "Bocian", "Gołąb", "Kruk", "Sroka", "Sowa",
    "Szczygieł", "Drozd", "Szpak", "Mewa", "Wrona", "Dzięcioł",
  ] },
  { lang: "ru", weight: 4, birds: [
    "Vorobey", "Sinitsa", "Lastochka", "Solovey", "Sokol", "Orel", "Zhuravl", "Aist", "Golub", "Voron", "Soroka", "Sova",
    "Snegir", "Shchegol", "Drozd", "Skvorets", "Chaika", "Grach", "Filin",
  ] },
  { lang: "ar", weight: 3, birds: [
    "Asfour", "Bulbul", "Hamama", "Nasr", "Saqr", "Shahin", "Hudhud", "Ghurab", "Laqlaq", "Karawan", "Summan", "Nawras",
    "Tawus", "Yamama",
  ] },
  { lang: "uk", weight: 2, birds: [
    "Horobets", "Synytsia", "Lastivka", "Solovei", "Sokil", "Orel", "Zhuravel", "Leleka", "Holub", "Voron", "Soroka", "Sova",
    "Snihur", "Shchyhol", "Drizd", "Shpak", "Zozulia", "Diatel",
  ] },
  { lang: "bs-hr-sr", weight: 2, birds: [
    "Vrabac", "Sjenica", "Lastavica", "Slavuj", "Soko", "Orao", "Ždral", "Roda", "Golub", "Gavran", "Svraka", "Sova",
    "Zeba", "Češljugar", "Drozd", "Čvorak", "Galeb", "Vrana",
  ] },
  { lang: "ro", weight: 2, birds: [
    "Vrabie", "Pițigoi", "Rândunică", "Privighetoare", "Șoim", "Vultur", "Cocor", "Barză", "Porumbel", "Corb", "Coțofană",
    "Bufniță", "Sticlete", "Sturz", "Graur", "Pescăruș", "Cuc", "Mierlă",
  ] },
  { lang: "it", weight: 2, birds: [
    "Passero", "Rondine", "Usignolo", "Falco", "Aquila", "Cicogna", "Colombo", "Corvo", "Gazza", "Civetta", "Fringuello",
    "Cardellino", "Tordo", "Storno", "Gabbiano", "Merlo", "Picchio", "Allodola", "Pettirosso",
  ] },
  { lang: "ku", weight: 1, birds: ["Kew", "Bilbil", "Kotir", "Çivîk", "Qertel", "Şahîn", "Qijik", "Qaz"] },
  { lang: "el", weight: 1, birds: [
    "Chelidoni", "Aidoni", "Geraki", "Aetos", "Pelargos", "Peristeri", "Korakas", "Koukouvagia", "Kotsyfas", "Glaros",
    "Geranos", "Tsichla", "Psaroni", "Karderina",
  ] },
  { lang: "da", weight: 1, birds: [
    "Spurv", "Mejse", "Svale", "Nattergal", "Falk", "Ørn", "Trane", "Stork", "Due", "Ravn", "Skade", "Ugle", "Solsort",
    "Stær", "Måge", "Krage", "Lærke", "Finke",
  ] },
  { lang: "hsb", weight: 1, birds: ["Kruk", "Sowa", "Wróbl", "Hołb", "Žoraw", "Sroka", "Škórc", "Kós"] },
  { lang: "nds", weight: 1, birds: [
    "Adebar", "Lüünk", "Swaalk", "Kreih", "Uul", "Kiewitt", "Lewark", "Heister", "Duuv", "Spreen", "Haavk", "Kuckuck",
  ] },
  { lang: "nl", weight: 1, particles: { van: 25, de: 15 }, birds: [
    "Merel", "Mus", "Mees", "Specht", "Zwaluw", "Spreeuw", "Ekster", "Kraai", "Duif", "Uil", "Valk", "Arend", "Reiger",
    "Ooievaar", "Kievit", "Leeuwerik", "Vink", "Roodborst", "Meeuw",
  ] },
  { lang: "hi", weight: 1, birds: [
    "Mor", "Tota", "Koyal", "Maina", "Bulbul", "Kabootar", "Chil", "Baaz", "Saras", "Bagula", "Kauwa", "Gauraiya", "Ullu",
    "Papiha", "Hans",
  ] },
  { lang: "zh", weight: 1, birds: [
    "Maque", "Yanzi", "Xique", "Huangli", "Bailing", "Dujuan", "Yingwu", "Gezi", "Wuya", "Laoying", "Kongque", "Yuanyang",
    "Huamei", "Cuiniao", "Haiou", "Xianhe",
  ] },
];
const WEIGHT = LANGUAGES.reduce((s, l) => s + l.weight, 0);

/** The language for a hash (by weight). */
function languageOf(h) {
  let r = h % WEIGHT;
  for (const l of LANGUAGES) {
    if (r < l.weight) return l;
    r -= l.weight;
  }
  return LANGUAGES[0];
}

/** The particle before the family name with its space ("van "), or "" (by the per cent of the language). */
function particleOf(lang, h) {
  let r = h % 100;
  for (const [word, share] of Object.entries(lang.particles ?? {})) {
    if (r < share) return `${word} `;
    r -= share;
  }
  return "";
}

/** "A. Fink", "M. van Vink" */
export const shortName = (name) => {
  const [first, ...rest] = String(name).split(" ");
  return rest.length ? `${first[0]}. ${rest.join(" ")}` : name;
};

/** A person of a simulation; simulations extend it with what they need. */
export class Person {
  /** @param {{id: string, name: string, lang?: string, role?: string, home?: object|null}} spec and more fields */
  constructor({ id, name, lang = null, role = null, home = null, ...more }) {
    this.id = id;
    this.name = name;
    /** Language of the name (code, e.g. "de"). */
    this.lang = lang;
    this.role = role;
    this.home = home;
    Object.assign(this, more);
  }
}

/**
 * The people of one simulation. A person is made from a key (what identifies the person in the
 * simulation, e.g. a role and a number): the same seed and key give the same name.
 */
export class Population {
  /**
   * @param {number|string} seed
   * @param {string} scope who they are (e.g. "crew"), part of every key
   * @param {Iterable<Person>} [people] people made before (their names stay taken)
   */
  constructor(seed, scope, people = []) {
    this.seed = seed;
    this.scope = scope;
    /** @type {Map<string, Person>} */
    this.people = new Map();
    this.names = new Set();
    for (const p of people) this._take(p);
  }

  /** A random stream of a person (and a purpose). */
  rng(key, ...parts) {
    const rng = createRng(hashKey(this.seed, this.scope, ...[key].flat(), ...parts));
    rng.next();
    return rng;
  }

  /** A free name for the key: {name, lang}, two different birds of one language. */
  name(key) {
    const k = [this.seed, this.scope, ...[key].flat()];
    const lang = languageOf(hashKey(...k, "lang")), birds = lang.birds;
    let name;
    for (let i = 0; i < 50; i++) {
      const f = hashKey(...k, i, "f") % birds.length;
      const l = (f + 1 + (hashKey(...k, i, "l") % (birds.length - 1))) % birds.length;
      name = `${birds[f]} ${particleOf(lang, hashKey(...k, i, "p"))}${birds[l]}`;
      if (!this.names.has(name)) break;
    }
    return { name, lang: lang.lang };
  }

  /**
   * A new person.
   * @param {string|Array} key
   * @param {object} [spec] fields of the person (`id` defaults to the key)
   * @param {typeof Person} [Kind] class of the person
   */
  add(key, spec = {}, Kind = Person) {
    const p = new Kind({ id: [key].flat().join("-"), ...this.name(key), ...spec });
    this._take(p);
    return p;
  }

  _take(p) {
    this.people.set(p.id, p);
    this.names.add(p.name);
  }

  get size() {
    return this.people.size;
  }

  [Symbol.iterator]() {
    return this.people.values();
  }
}

/**
 * Where a person lives: beyond the layout by train (`outer`, with the probability `outerShare`),
 * else in a house on the layout (by its weight), else away by car.
 * @param {{next: Function, chance: Function, int: Function, weighted: Function, uniform: Function}} rng
 * @param {{homes?: Array<{id: string, name?: string, walkM?: number, weight?: number}>,
 *   outer?: Array<{station: string, line: string}>, outerShare?: number, awayMinutes?: number}} o
 */
export function pickHome(rng, { homes = [], outer = [], outerShare = 0, awayMinutes = 20 } = {}) {
  if (outer.length && rng.chance(outerShare)) {
    const o = outer[rng.int(outer.length)];
    return { kind: "station", station: o.station, line: o.line };
  }
  if (homes.length) {
    const h = homes[rng.weighted(homes.map((x) => x.weight ?? 1))];
    return { kind: "layout", building: h.id, name: h.name ?? h.id, walkM: h.walkM };
  }
  return { kind: "away", minutes: Math.max(5, Math.round(awayMinutes * rng.uniform(0.5, 1.3))) };
}

/** The residential buildings of a world: [{o, id, name, residents}] (with at least one resident). */
export function residentialBuildings(world) {
  const out = [];
  for (const o of world.objects) {
    if (!o.geometry || typeof o.capacity !== "function") continue;
    const use = typeof o.use === "function" ? o.use() : o.constructor.use;
    const residents = o.capacity()?.residents || 0;
    if (use === "residential" && residents > 0) out.push({ o, id: o.id, name: o.name, residents });
  }
  return out;
}
