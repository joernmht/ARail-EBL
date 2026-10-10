# Languages

The app speaks English and German ([#120](https://github.com/joernmht/ARail-EBL/issues/120)). German covers the page's frame (the bar, the stage's buttons, the tabs), the HUD, the panels **View**, **Settings** and **Build** (with the settings of every object type), **Disruptions**, the info cards with their train data, systems and where a train may run, and the labels on the stage. The tabs Terminal, Operations, Infrastructure and Journeys are still English, as are the project page, the marker page and the guides.

## Choosing the language

- **View → Language**: *English* or *Deutsch*. The app switches at once (nothing is reloaded, the simulation goes on) and keeps the choice on this device.
- **A link**: `app/?lang=de` (or `?lang=en`) shows the app in that language, e.g. for the projector or a kiosk, without changing what a device has chosen.
- **Otherwise** the browser's language: German for a browser set to German, else English.

Numbers follow the language: *2,5 t* and *1.234 €* in German, *2.5 t* and *1,234 €* in English.

## How it works

The framework stays English: its cards, labels and settings are English texts. The app translates what it shows ([`web/app/i18n.js`](../web/app/i18n.js)):

- `h()` (the app's small DOM helper) translates the texts of the elements it makes and the attributes people read or hear (`aria-label`, `title`, `alt`, `placeholder`); an element with `translate: "no"` keeps its texts (names, what people typed).
- The `View` translates the labels on the canvas (its option `translate`).
- The page's own markup (`index.html`) is translated when the app starts and when the language is switched.

The translator ([`web/arail/i18n/index.js`](../web/arail/i18n/index.js), `Translator`) works without a build step. **The English text is the key**, so code stays readable and a text without a translation stays English. It finds a text

1. as a whole in the catalogue;
2. else by the **pattern** of an entry with placeholders: `"{n} min late": "{n} min Verspätung"` translates *4 min late*; the variable parts are translated in turn (`"Waiting for {what}"` and `"the bus"` give *Wartet auf den Bus*), and numbers get the language's decimal sign. `{n}`, `{id}` and `{time}` (also `{n2}`, …) stand for one word or number, other names for any text up to " · ";
3. else part by part between " · " (*4 min late · Waiting for the bus*).

Plural forms are chosen with `Intl.PluralRules`: `"{n} tracks": {one: "{n} Gleis", other: "{n} Gleise"}`; the English singular is in the English catalogue (`"{n} tracks": {one: "{n} track"}`), so *1 track* is found as well. What has no translation is noted in `i18n.missing` (in the browser: `(await import("/app/i18n.js")).i18n.missing`), which shows what is still to translate.

## Adding texts

- **The app's texts**: [`web/app/lang/de.js`](../web/app/lang/de.js).
- **The framework's texts** (object types and their settings, cards, labels, railway systems, trains): [`web/arail/i18n/de.js`](../web/arail/i18n/de.js); English singulars in `en.js`.
- **A plugin** brings its own: `registry.registerTexts("de", {"Windmill": "Windmühle", "Sail speed": "Flügeldrehzahl"})`.
- In the app, build a text with `t("{n} people", {n})` where its parts change, or write it out and let `h()` translate it; `tr(text)` translates a finished text where no `h()` is involved (a toast, `textContent`).
- Long German compounds may get soft hyphens (`Empfangs­gebäude`) where they must fit a narrow box.

`tests/js/i18n.test.js` checks that every translation keeps the placeholders of its English text, that no text is in a catalogue twice, that every text the app asks for by name (`t("…")`, `tr("…")`) and the page's markup have a German translation, and the German cards of the framework; `tests/e2e/i18n.spec.js` opens the app in German and fails when the panels View, Settings and Build or a train's card show English that is not a name, a code or a number.

A further language is a catalogue per file (`web/arail/i18n/<lang>.js`, `web/app/lang/<lang>.js`), registered like the German one, and an entry in `UI_LANGUAGES`.

## Glossary of railway terms

The German terms follow the German rulebooks (EBO, Ril 408) and the names of the EU Register of Infrastructure (RINF). They are to be reviewed by the chair; the quiz can use the same list.

| English | German |
| --- | --- |
| platform | Bahnsteig |
| track | Gleis |
| train protection (class B) | Zugbeeinflussung (Klasse-B-System) |
| traction power | Bahnstromsystem |
| pantograph head | Stromabnehmerwippe |
| signal box, interlocking | Stellwerk |
| relay / electronic / digital interlocking | Relaisstellwerk / ESTW / DSTW |
| switch (turnout) | Weiche |
| level crossing | Bahnübergang |
| overhead line | Oberleitung |
| line category (EN 15528) | Streckenklasse |
| axle load / metre load | Radsatzlast / Meterlast |
| loading gauge | Begrenzungslinie |
| line speed | Streckengeschwindigkeit |
| brake percentage / required brake percentage | Bremshundertstel / Mindestbremshundertstel |
| brake position | Bremsstellung |
| consist | Zugbildung |
| system separation section | Systemtrennstelle |
| train control transition | Wechsel der Zugbeeinflussung |
| infrastructure manager | Infrastrukturbetreiber (EIU) |
| railway undertaking | Eisenbahnverkehrsunternehmen (EVU) |
| train reporting | Zugmeldung |
| hauled without power | kalt geschleppt |
| depot | Betriebswerk |
| stabling track | Abstellgleis |
| maintenance base | Instandhaltungsstützpunkt |
| passenger display | Zugzielanzeiger |
| control system | Leitsystem |
| fast clock | Modellzeit |
| rail replacement bus | Schienenersatzverkehr |
