#!/usr/bin/env node
// Downloads the web fonts once from Google Fonts into web/assets/fonts/, so that the pages
// load them from our own server: no visitor's address goes to Google (GDPR), and the app works
// in lab networks without internet.
//   node tools/fetch-fonts.mjs
// Writes one stylesheet per set (fonts-app.css, fonts-markers.css) with the Latin and Latin
// Extended subsets, the WOFF2 files and the fonts' licence texts (SIL Open Font License 1.1).
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const OUT = resolve("web/assets/fonts");
// A current browser gets WOFF2 files with unicode-range subsets.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SUBSETS = ["latin", "latin-ext"];
const SETS = {
  // the app, the project page and the 404 page
  "fonts-app.css": "family=Noto+Sans:wght@400;500;700;800&family=Noto+Sans+Mono:wght@400;600",
  // the marker sheets
  "fonts-markers.css": "family=Archivo:wdth,wght@75..100,400..800&family=JetBrains+Mono:wght@400;600",
};
const LICENSES = { notosans: "NotoSans", notosansmono: "NotoSansMono", archivo: "Archivo", jetbrainsmono: "JetBrainsMono" };

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "bytes" ? Buffer.from(await res.arrayBuffer()) : res.text();
}

await mkdir(OUT, { recursive: true });
const files = new Map(); // Google URL -> local file name
for (const [sheet, query] of Object.entries(SETS)) {
  const css = await get(`https://fonts.googleapis.com/css2?${query}&display=swap`);
  const faces = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[^}]+\})/g)].filter((m) => SUBSETS.includes(m[1]));
  let out = `/* ${sheet.replace(".css", "")}: self-hosted by tools/fetch-fonts.mjs. Fonts: SIL Open Font License 1.1, see OFL-*.txt. */\n`;
  for (const [, subset, face] of faces) {
    const family = face.match(/font-family: '([^']+)'/)[1].replace(/ /g, "");
    const url = face.match(/url\((https:[^)]+)\)/)[1];
    if (!files.has(url)) {
      // Google serves variable fonts: one file per family and subset covers all weights.
      const style = face.match(/font-style: (\w+);/)[1];
      let name = `${family}-${style === "normal" ? "" : style + "-"}${subset}.woff2`;
      if ([...files.values()].includes(name)) name = name.replace(".woff2", `-${files.size}.woff2`);
      files.set(url, name);
      await writeFile(join(OUT, name), await get(url, "bytes"));
    }
    out += `/* ${subset} */\n${face.replace(url, files.get(url))}\n`;
  }
  await writeFile(join(OUT, sheet), out);
  console.log(`${sheet}: ${faces.length} faces`);
}
for (const [dir, name] of Object.entries(LICENSES)) {
  await writeFile(join(OUT, `OFL-${name}.txt`), await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/OFL.txt`));
}
console.log(`${files.size} font files in ${OUT}`);
