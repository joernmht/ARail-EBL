# The builder: streets and layouts

The **builder** (`builder/`, `web/builder/`) is a street and layout editor of its own, beside the
app. The app's **Build** tab stays as it is. The builder shows the layout as a plan from above. You
draw streets that join where they meet, and put bus stops, bus terminals, truck lanes and buildings
next to a street. A check lists everything that has no street leading to it, with a fix to click.
When the layout is done, **Push to GitHub** puts it into the repository in one commit, together with
covered photos you made yourself.

Open it at [joernmht.github.io/ARail-EBL/builder/](https://joernmht.github.io/ARail-EBL/builder/),
or locally at `http://localhost:8000/builder/` after `npm start`.

## The plan

The layout is drawn by the same code as the app, from straight above: north (+y) is up, the front of
the table at the bottom.

- **Move the plan**: drag it (or hold Space and drag, or use the middle mouse button). The wheel or
  two fingers zoom, **+** and **−** zoom, **Home** (or **0**) shows the whole layout.
- **Photo**: the orthophoto of the table (`view.ortho`), over the table modules.
- **Grid**: the layout's grid. Points snap to it; hold **Alt** to place freely.
- **Plain**: plain shapes instead of the detailed view (faster on large layouts).

The dashed teal lines are the ways from building entrances and stops to their street, as the road
network connects them (`world.network()`). Teal dots are junctions. A red **!** marks something that
does not work, an orange one something that makes no sense.

## Streets first

Choose **Street** (key **S**), **Residential street**, **Main road**, **Footpath** (key **F**) or
**Underpass**, then click the points of the street.

- A click near the end or a corner of another street snaps onto it: the two streets join there.
- A click on another street puts the point on its centre line: a T junction.
- Streets that cross are joined at the crossing (an X junction).
- A point level with the point before it (or right above or below it) stays level: straight streets
  stay straight even where they start off the grid.
- **Shift** keeps the direction from the point before in steps of 15°.
- **Double-click**, **Enter** or **Finish** ends the street; **Backspace** takes the last point
  back; **Esc** stops. The tool stays chosen for the next street.

A selected street shows its corners as squares; **point 1** is where it starts.

- Drag a corner to move it. It snaps like a new point but never onto its own street.
- **Double-click** on the street adds a corner there.
- Click a corner, then **Delete**, to take it out.
- **Reverse direction** turns the street round. This matters for a truck lane, whose first point is
  where trucks drive in, and for the sides of bus stops.

## Then what needs a street

Put these next to a street, and they fit it:

| Element | Placed |
| --- | --- |
| **Bus stop** (key **B**) | On the street next to the click, on the side clicked (seen in the street's direction). Choose *both sides* in the Element tab for a line that runs back and forth. |
| **Bus terminal** | Along the nearest street; its bus lane is connected to the streets within 40 m. |
| **Bus line** | Click its stops in order, then finish. |
| **Truck lane** | Click its points in driving direction: the first point is the entry. |
| **Station building**, **House**, **Building** and the other buildings | Turned with its front, and the entrance, to the nearest street. **Face the street** turns it again after you move it. |

**Other elements…** has every other type of the layout format, by category. A new element is
selected: change it in the **Element** tab. There you also find **Turn 15° (R)** (Shift+R: 90°),
**Duplicate** and **Delete**. Drag an element to move it; the arrow keys move the selected one.

## The Problems tab

Everything people and vehicles come to needs a street that leads there. The check
(`web/arail/core/access.js`) runs after every change:

| Problem | Level | Fix |
| --- | --- | --- |
| A truck lane has no street within 20 m of its entry, or of its end | does not work | *Add a street to …*: a street to the nearest street. In a layout without streets: a street to the edge of the layout, or a short one out of it where the lane ends at the edge. |
| A bus terminal's lane has no street within 40 m of an end | does not work | a street to the nearest street |
| A bus stop is not right next to a street for buses (the stop says so itself if no street is near) | does not work | none: drag it onto a street |
| People cannot reach a platform or stop: no street or footpath within 80 m of any of its ways in (not across a track) | makes no sense | a footpath to the nearest street; an **underpass** where tracks are in the way |
| A building's entrance has no street or footpath within 80 m | makes no sense | a footpath to the nearest street |
| The maintenance base's vans have no street for cars within 80 m | does not work | a street to the nearest street |
| Streets for cars that are not connected to the others | makes no sense | a street from their nearest end to the others |
| A street ends a few metres (up to 15 m) before another one | makes no sense | *Join it to …*: its end is moved onto the other street |
| A dead end inside the layout (more than 10 m from its edge) | makes no sense | none: lead it to the edge or join it. Cars come and go at dead ends, as if the street went on beyond the layout. |

The tab also lists what elements say of themselves (a truck lane that no crane reaches, a bus line
without a way along the streets) and problems of the layout file. **Show** zooms to the element.
**Carry out all fixes** applies them one after another; **Undo** takes them back one by one.

## Undo, drafts and modules

Every change is a step of **Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z or Ctrl+Y). Changes that are
not pushed are kept in this browser: when you open the same layout again, they come back. The bar
says how many changes are not pushed.

**Layout** has the layout's name and description, and its **modules** (layers). Showing a module
changes nothing in the file. New elements go into the module chosen there, or into the layout
itself. **Download the layout file** gives you the file as it would be pushed.

## Covered photos

A **covered photo** is the same photo with everything that is not the layout painted over: walls,
windows, the floor, chairs. You make it yourself in an image editor, for example by painting the room
transparent and saving a PNG. Transparent or blank parts are fine: the app fills them with the colour
of the lab floor. The app shows the covered photo instead of the photo.

In the **Photos** tab, choose a covered photo for:

- the layout's own photo (`view.image`); it is pushed as `<photo>-covered.png` (or `.jpg`, `.webp`)
  beside it and linked as `view.image_covered`;
- the photos of the photo map that open with this layout (its layer). They are pushed beside the
  photo in `web/lab-map/photos/` and linked as `covered` in `web/lab-map/data.json`. The photo tour
  then shows them covered.

## Push to GitHub

**Push to GitHub** shows the files of the push: the layout (if it changed), the covered photos, and
the photo map if a photo of it got a covered one. Then:

1. **The token.** Make a fine-grained personal access token on GitHub: *Settings → Developer
   settings → Personal access tokens → Fine-grained tokens → Generate new token*. Give it access to
   this repository only and the permission **Contents: Read and write**. Paste it into the dialog. It
   is kept for this tab; **Remember the token on this device** keeps it in this browser's storage.
   It is sent to GitHub only.
2. **What changed** is the commit message, written for you.
3. **Push to main** commits all files in one commit on `main`. GitHub Pages deploys it, and the
   website shows it a few minutes later.

Each file changes only where you edited it. The builder merges your changes into the file's own JSON
(not the defaults the app fills in) and writes them into the file's own text. Everything else keeps
its text: a moved bus stop is one changed line, a new street one new line written like its
neighbours.

**Open in the app** opens the layout in the app as the website has it: pushed changes once the
website shows them, not the unpushed ones. If you changed the same layout in the app's Build tab on
this device, the app keeps showing those edits until **Build → Reset to original**.

If someone changed a file on GitHub since you opened it, the push stops and says so. **Open the
version on GitHub** opens that version; your changes stay as a draft. **Push anyway, over it**
replaces theirs. If `main` moves while you push (another commit), your commit goes on top of it.

## Keys

| Key | |
| --- | --- |
| V | Select and move |
| S, F, B | Street, footpath, bus stop |
| Enter, double-click | Finish the street (or line) |
| Backspace | While drawing: take the last point back |
| Delete, Backspace | Delete the selected element, or the selected corner |
| R, Shift+R | Turn the selected element by 15°, by 90° |
| Arrow keys | Move the selected element (Shift: farther); without one, move the plan |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | Undo, redo |
| +, −, Home | Zoom in, zoom out, the whole layout |
| Esc | Stop drawing, or deselect |

## Addresses

- `builder/?layout=../layouts/ebl-lab.json`: the layout to open (as in the app); without it, the
  layout opened last, else Bf Neustadt.
- `?repo=owner/name&branch=…`: push to a fork or another branch.
- `?lang=de`: in German.

## For developers

The page is `web/builder/`. `builder.js` holds the page. `plan.js` draws the plan with the
framework's `View` or `SimpleView` and a `FlyCamera` looking straight down. `place.js` holds the
snapping and placing rules, `history.js` the undo, `json-text.js` the minimal changes to a file, and
`github.js` the commits through GitHub's REST API (blobs, a tree, a commit, the branch moved on).
`place.js`, `history.js`, `json-text.js`, `github.js` and the access check run in Node and have
tests (`tests/js/access.test.js`, `tests/js/builder-*.test.js`). The browser tests
(`tests/e2e/builder.spec.js`) push to a GitHub inside the test. See the
[architecture page](https://joernmht.github.io/ARail-EBL/architecture/#model-builder).
