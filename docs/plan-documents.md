# Plan documents

The page **Plan documents** (`plan/`, [open it](https://joernmht.github.io/ARail-EBL/plan/)) draws the
infrastructure of a layout as a plan sheet, the way a CAD drawing is plotted: tracks, platforms,
signals, switches and the other elements at a standard scale, on ISO paper with the drawing frame and
the title block. Print it at its true size, or save it as SVG, as DXF for a CAD program, or as
[rail-infra/1](rail-infra-format.md) data, the exchange format ARail shares with the EBL's digital twin.

## Sources

- **ARail's layouts**: Bf Neustadt (with its module *Infrastructure*, so its signals and the interlocking
  are on the sheet), the lab example Beta 0.1, the container terminal, the hybrid container train. The
  boxes under the source switch the layout's modules on and off.
- **A file** (*Open a file*): an ARail layout or a rail-infra file.
- **A URL**: `plan/?src=<url>` opens a layout or a rail-infra file by its URL, `?layout=` a layout.

### The EBL's track plan and hall plan

The EBL's digital twin (`5 Digitaler Zwilling` in the lab's own repository) writes the lab's
infrastructure in rail-infra/1:

```sh
python -m ebl_twin infra          # web/data/ebl-infra-plan.json and web/data/ebl-infra-hall.json
python -m ebl_twin serve          # http://127.0.0.1:8090/api/infra?frame=plan (or hall)
```

- the **track plan**: the whole network schematically in kilometre order (Neustadt, Waldhof, Adorf,
  Zellwald, …, the staging yard below), every signal, switch, buffer stop, balise and stop board at
  its kilometre on its track. It fills 13 sheets A3 at 3 mm per lane, or 9 sheets A1 at 4 mm; each
  says where the plan goes on.
- the **hall plan**: every track where it stands in the lab, in mm of the hall frame of the survey,
  on the two rings of tables (the hall at 1:100 on A1, 1:50 on A0).

Open the file in the plan view, or, while the twin's server runs on the same computer,
`plan/?src=http://127.0.0.1:8090/api/infra?frame=plan`. The server lets only ARail's site and pages
served on this computer read it (CORS). The lab's data stay in the lab's repository: ARail does not
copy them.

## The sheet

| Setting | |
| --- | --- |
| **Paper** | A4 to A0, landscape. The frame (ISO 5457): 20 mm filing margin at the left, 10 mm elsewhere, zones of about 50 mm (letters down, numbers across) for references such as "C4", centring marks. |
| **Scale** | *Auto*: the largest standard scale (ISO 5455: 1:1, 1:2, 1:5, 1:10, 1:20, 1:25, 1:50, 1:100, …) at which the plan fits one sheet. A larger scale cuts the plan into sheets. A schematic plan (frame in lanes) is drawn at so many mm per lane; one that is too long for a sheet is cut along its length at 4 mm per lane. |
| **Sheet** | the sheet shown; *Previous sheet*, *Next sheet*. |
| **Drawing layers** | tables and rooms, tracks, platforms, signals, switches and other elements, kilometres, names, the coordinate grid. |
| **Title block** | (ISO 7200) legal owner, document type (*Site plan* in mm, *Track plan* in lanes), status, title and supplementary title, drawing number, scale, frame, sheet size, date of issue, revision, sheet *n/N*, created by, source. Title, drawing number, author and revision can be typed in. |

The **legend** (left of the title block) shows the symbols on the sheet; the **scale bar** next to it
also gives the length in the prototype (model scale 1:87). Tracks not on the real layout (virtual
table modules, the hidden staging yard) are dashed. Names keep clear of each other: the operating
points first, then labels and tracks, then the elements.

The symbols are simplified after those of track plans (Ril 819.9002): a signal's foot beside the
track, its mast in the direction it applies to, its screen at the end (main signal filled, distant
signal open and struck through, block signal with a ring, shunting signal a half-filled square); a
switch as a black wedge opening to its branch; a buffer stop as a double bar.

## Printing and saving

- **Print** prints the sheet at its true size: set the printer to the paper chosen, at 100 %
  (the page's print size is the paper's).
- **SVG**: the sheet shown, in mm.
- **DXF**: the whole plan for CAD (AutoCAD R12, which every CAD program reads): model space at its true
  size in mm (a schematic plan at `lane_mm`, else 10 mm per lane), one layer per kind of thing
  (`TRACKS`, `TRACKS_HIDDEN`, `LINKS`, `PLATFORMS`, `SIGNALS`, `SWITCHES`, `ELEMENTS`, `KM`, `NAMES`,
  `OPERATING_POINTS`, `AREAS`), names as text, the kilometre beside each element.
- **rail-infra data**: the document drawn, e.g. a layout converted, to use elsewhere.

## In code

```js
import { composeLayout, layoutToInfra, drawSheet, toDXF } from "./web/arail/index.js";

const doc = layoutToInfra(composeLayout(layoutJson).layout);
const { svg, sheets } = drawSheet(doc, { paper: "A3", scale: "auto", sheet: 1 });
const dxf = toDXF(doc);
```

Everything runs in Node too, and draws the same sheet every time.
