/**
 * Names of simulated people are made of bird names, so nobody in the simulation is a real person.
 * Each person gets one language, and both parts of the name are birds in that language. The weights
 * (per cent) are a rough picture of the languages of the people living in Germany: German, the largest groups with an
 * immigration history (Mikrozensus), Low German (Plattdeutsch) and two of the recognised national
 * minorities (Danish, Sorbian).
 * Names in non-Latin scripts are transliterated.
 * @module arail/ops/names
 */
import { hashKey } from "./util.js";

/** Bird names per language, with the weight (per cent) of the language. */
export const BIRDS = [
  { lang: "de", weight: 68, names: [
    "Amsel", "Drossel", "Fink", "Meise", "Specht", "Sperling", "Lerche", "Elster", "Rabe", "Krähe", "Taube", "Schwalbe",
    "Star", "Storch", "Reiher", "Kranich", "Eule", "Kauz", "Falke", "Bussard", "Habicht", "Adler", "Zeisig", "Stieglitz",
    "Gimpel", "Dohle", "Kiebitz", "Wachtel", "Pirol", "Wiedehopf", "Eisvogel", "Zaunkönig", "Ammer", "Schwan", "Möwe", "Kuckuck",
  ] },
  { lang: "tr", weight: 5, names: [
    "Serçe", "Kartal", "Şahin", "Doğan", "Turna", "Leylek", "Bülbül", "Kumru", "Güvercin", "Karga", "Baykuş", "Saksağan",
    "Kırlangıç", "Martı", "Toygar", "Atmaca",
  ] },
  { lang: "pl", weight: 4, names: [
    "Wróbel", "Sikora", "Jaskółka", "Słowik", "Sokół", "Orzeł", "Żuraw", "Bocian", "Gołąb", "Kruk", "Sroka", "Sowa",
    "Szczygieł", "Drozd", "Szpak", "Mewa", "Wrona", "Dzięcioł",
  ] },
  { lang: "ru", weight: 4, names: [
    "Vorobey", "Sinitsa", "Lastochka", "Solovey", "Sokol", "Orel", "Zhuravl", "Aist", "Golub", "Voron", "Soroka", "Sova",
    "Snegir", "Shchegol", "Drozd", "Skvorets", "Chaika", "Grach", "Filin",
  ] },
  { lang: "ar", weight: 3, names: [
    "Asfour", "Bulbul", "Hamama", "Nasr", "Saqr", "Shahin", "Hudhud", "Ghurab", "Laqlaq", "Karawan", "Summan", "Nawras",
    "Tawus", "Yamama",
  ] },
  { lang: "uk", weight: 2, names: [
    "Horobets", "Synytsia", "Lastivka", "Solovei", "Sokil", "Orel", "Zhuravel", "Leleka", "Holub", "Voron", "Soroka", "Sova",
    "Snihur", "Shchyhol", "Drizd", "Shpak", "Zozulia", "Diatel",
  ] },
  { lang: "bs-hr-sr", weight: 2, names: [
    "Vrabac", "Sjenica", "Lastavica", "Slavuj", "Soko", "Orao", "Ždral", "Roda", "Golub", "Gavran", "Svraka", "Sova",
    "Zeba", "Češljugar", "Drozd", "Čvorak", "Galeb", "Vrana",
  ] },
  { lang: "ro", weight: 2, names: [
    "Vrabie", "Pițigoi", "Rândunică", "Privighetoare", "Șoim", "Vultur", "Cocor", "Barză", "Porumbel", "Corb", "Coțofană",
    "Bufniță", "Sticlete", "Sturz", "Graur", "Pescăruș", "Cuc", "Mierlă",
  ] },
  { lang: "it", weight: 2, names: [
    "Passero", "Rondine", "Usignolo", "Falco", "Aquila", "Cicogna", "Colombo", "Corvo", "Gazza", "Civetta", "Fringuello",
    "Cardellino", "Tordo", "Storno", "Gabbiano", "Merlo", "Picchio", "Allodola", "Pettirosso",
  ] },
  { lang: "ku", weight: 1, names: ["Kew", "Bilbil", "Kotir", "Çivîk", "Qertel", "Şahîn", "Qijik", "Qaz"] },
  { lang: "el", weight: 1, names: [
    "Chelidoni", "Aidoni", "Geraki", "Aetos", "Pelargos", "Peristeri", "Korakas", "Koukouvagia", "Kotsyfas", "Glaros",
    "Geranos", "Tsichla", "Psaroni", "Karderina",
  ] },
  { lang: "da", weight: 1, names: [
    "Spurv", "Mejse", "Svale", "Nattergal", "Falk", "Ørn", "Trane", "Stork", "Due", "Ravn", "Skade", "Ugle", "Solsort",
    "Stær", "Måge", "Krage", "Lærke", "Finke",
  ] },
  { lang: "hsb", weight: 1, names: ["Kruk", "Sowa", "Wróbl", "Hołb", "Žoraw", "Sroka", "Škórc", "Kós"] },
  { lang: "nds", weight: 1, names: [
    "Adebar", "Lüünk", "Swaalk", "Kreih", "Uul", "Kiewitt", "Lewark", "Heister", "Duuv", "Spreen", "Haavk", "Kuckuck",
  ] },
  { lang: "nl", weight: 1, names: [
    "Merel", "Mus", "Mees", "Specht", "Zwaluw", "Spreeuw", "Ekster", "Kraai", "Duif", "Uil", "Valk", "Arend", "Reiger",
    "Ooievaar", "Kievit", "Leeuwerik", "Vink", "Roodborst", "Meeuw",
  ] },
  { lang: "hi", weight: 1, names: [
    "Mor", "Tota", "Koyal", "Maina", "Bulbul", "Kabootar", "Chil", "Baaz", "Saras", "Bagula", "Kauwa", "Gauraiya", "Ullu",
    "Papiha", "Hans",
  ] },
  { lang: "zh", weight: 1, names: [
    "Maque", "Yanzi", "Xique", "Huangli", "Bailing", "Dujuan", "Yingwu", "Gezi", "Wuya", "Laoying", "Kongque", "Yuanyang",
    "Huamei", "Cuiniao", "Haiou", "Xianhe",
  ] },
];
const BIRD_WEIGHT = BIRDS.reduce((s, b) => s + b.weight, 0);

/** The bird names of a person's language (picked by weight from a hash). */
function birdsOf(h) {
  let r = h % BIRD_WEIGHT;
  for (const b of BIRDS) {
    if (r < b.weight) return b.names;
    r -= b.weight;
  }
  return BIRDS[0].names;
}

/**
 * A name not in `used` (and added to it), stable for the seed and the key: two different birds
 * of one language.
 * @param {Set<string>} used
 * @param {...*} key seed and what identifies the person
 */
export function birdName(used, ...key) {
  const birds = birdsOf(hashKey(...key, "lang"));
  let name;
  for (let k = 0; k < 50; k++) {
    const f = hashKey(...key, k, "f") % birds.length;
    const l = (f + 1 + (hashKey(...key, k, "l") % (birds.length - 1))) % birds.length;
    name = `${birds[f]} ${birds[l]}`;
    if (!used.has(name)) break;
  }
  used.add(name);
  return name;
}
