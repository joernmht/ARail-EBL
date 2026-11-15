# Short videos: the story, the design, the steps

The project page opens with a short video that tells what ARail is without a word of explanation
around it. This guide describes its concept and its design, so that more short videos can be made
the same way: for a talk, a fair, a social post, one module of ARail. The tools behind it are
described in [Videos of the lab](videos.md).

## The concept

A short video is a story in four parts:

1. **The hook: the real lab** (3–5 s). The model railway as it is, real footage, moving trains. The
   first line, in the first row: *A real lab is awesome.*
2. **The turn** (about 5 s). *But what if…* is typed into the second row while the real picture
   fades into ARail, once:
   the one transition from real to virtual in the whole video. The viewer sees that the same table
   gets a second layer.
3. **The ideas** (most of the video). In the third row, one line per idea, each fitting the picture
   it is typed over: *…there are houses.*, *…there are trees.*, *…there are cars.*, *…there are ways to
   the office.*, *…there is a container terminal.*, *…the crane loads a real truck.*, *…night falls.*
   An idea gets one to three views of ARail. No more real pictures here, no more fades from real to
   virtual: the viewer has understood the trick.
4. **The question** (6–9 s). A wide, rendered picture of the whole town, slowly turning, in the
   chair's blue. The three rows are typed anew: *What if all that is possible?* / *What if all this
   is customizable overnight?* / *Would your work still be the same?*, the last in orange: it turns
   the video to the viewer.

Then the video loops back to the real lab.

### Rules of thumb

- **A view lasts about 3 s, never more than 6 s;** a part of a view (the real picture, the fade,
  ARail) at most 3 s. Short views keep the video moving; the slow push or pan within each makes a
  held picture alive.
- **Day and night.** A night sequence (the clock held at 22:30: lit windows, street lamps, the
  lights of the traffic) shows that the town lives around the clock.
- **Steady pictures only.** ARail drawn over a moving phone clip jitters unless its poses are
  stabilized ([the town video](videos.md#the-stabilization-step-by-step)). Every other view is one
  picture held, a frame of a clip with the app's Freeze or a photo, with the simulation running on,
  or a flyover shot.
- **Close-ups for people.** Travellers, riders and crowds need a camera close to them (the
  flyover, 300–400 mm of model from the target): in a wide view they are dots.
- **Group the views by idea**, the line at the start of its group. A line stays until the next
  one replaces it; replace it when the picture shows something new (cars, trees, the night), so a
  new line comes every 3–8 s.
- **The real lab only at the start.** After the turn, every view shows ARail.
- **No views that look wrong:** a photo seen at a steep angle (its buildings lean), a pose the app
  did not find, a crowd of red (angry) people because the scene was overfilled.

## The design

### The terminal box

The lines are typed into a box like an old computer's terminal (`tools/video/typewriter.mjs`):

| | |
| --- | --- |
| Place | upper centre, 26 px from the top (at 1280 × 720) |
| Size | fixed: 3 rows, 56 characters wide; it does not change with its text |
| Box | dark blue `rgba(0, 12, 48, .84)`, a teal border `rgba(54, 184, 191, .65)`, a faint teal glow, the lines of an old screen |
| Type | the site's Noto Sans Mono, 600, 24 px, line height 1.5 |
| Rows | each with the prompt `>` in teal `#36b8bf` |
| Text | the newest line `#e3f7f8` with a teal glow and the cursor; the older rows `#9fbccb` |
| Question | the orange of the departure boards, `#f0922e` (`"style": "accent"`) |
| Cursor | a teal block; it blinks while it waits, steady while typing |
| Typing | 20 characters a second; the line it replaces is backspaced first, at 60 a second |

Each line goes into a row (`"row"`: 1 to 3, default 3) and stays until the next line of that row
replaces it. The first two lines (*A real lab is awesome.*, *But what if…*) stay in the top rows
until the end, where the three rows are typed anew. The box stays from the first line to the end.

### The pictures

| | |
| --- | --- |
| Size | 16:9, 1280 × 720, 30 fps; the project page shows it over its whole width |
| Views | held pictures with a slow push (the crop shrinks by about 10 %) or a pan across |
| Between views | a crossfade of 0.4 s (12 frames) |
| The turn | the real picture fades into ARail over 0.8 s (`bare` with `fade`) |
| The question | the town in the flyover, wide (about 5 m of model from the target), turning slowly, tinted from `#000a2e` to `#6f9fcf` (`tint`) |
| Labels in a video | none: the name tags are off, the markers covered with grey plates |

### Writing the lines

Short, each a fragment of the question *what if…* and about what the picture shows: *…there are
travellers.*, *…there are trams and buses.*, *…there is a game.*, *…there are tailor-made missions.*
The three lines at the end widen it (all that is possible, customizable overnight) and ask the viewer
about their own work. No line longer than the box (56 characters).

## The shots there are

Each shot is a plan in `tools/video/plans/` and renders into `build/video/<name>/`:

| Shot | Plan | What it shows |
| --- | --- | --- |
| the real lab | (the clip itself) | `examples/media/ebl-station-trains.mp4`, the phone panning along Bf Neustadt |
| the turn | `town-pass1.json`, `town-pass2.json` | the curve with a freight train, then the town and its sky (stabilized, moving) |
| Bf Neustadt's town | `photos/132513.json`, `132542`, `132748`, `132537` | photos of the photo map in ARail |
| Bf Neustadt's station | `station.json`, `station-b.json`, `station-c.json`, `photos/132504.json`, `132517`, `132501`, `132758`, `132510` | frames of the station clip and photos |
| the container terminal | `terminal-photo.json`, `terminal-wagons-0.json`, `terminal-wagons.json`, `terminal-truck.json`, `crane-terminal.json`, `photos/141012.json`, `132253`, `132257` | the hybrid container train, the crane loading the truck |
| travellers, close | `platform-people.json`, `platform-people-2.json` | busy platforms, a train boarding (flyover) |
| bikes, close | `bikes.json` | riders on a bike lane beside a tram (flyover) |
| trams and buses, close | `trams-buses.json` | the station square, a tram coming in (flyover) |
| the whole town | `city-wide.json` | the town in the flyover, wide, turning |
| night | `night-town.json`, `night-station.json` | the town (photo 132542) and the station square at 22:30: lit windows, lamps, the traffic's lights |
| the wide hall | `photos/132821.json`, `132826` | the lab's hall with the town on the tables |
| the game | `screens/game-title.json` | the game page's title, its menu opened (recorded) |
| the missions | `screens/missions.json` | the big game's missions, one chosen, Play, the briefing (recorded) |

The rendered shots of the project page's video, each on its own and without lines, are kept with
the chair's presentations (`visuals/arail-shots/`), to cut into talks.

## Making a short video

1. **Pick the story.** One idea, or a few: a module (the terminal, the town, the operations), a
   question for one audience. Write the lines first.
2. **Pick or make the shots.** Use the table above. A new view:
   - a photo of the photo map with a digital layer: copy a plan in `plans/photos/` and change the id;
   - a frame of a lab clip: as `station.json` (`clip`, `start`, `track`, `freeze`);
   - a flyover close-up: as `platform-people.json` (`fly` with target, distance, yaw and pitch; `eval`
     for more people or riders, said in the plan's `about`). Its frames are 1210 × 938: crop a 16:9
     box within them (`[0, 129, 1210, 809]`); `arail-compose` refuses a crop outside the frames.
     The first frames of a flyover can be odd (the camera inside a building, the night lighting
     still settling): start the part later (`first`);
   - a page of the site: as `plans/screens/missions.json` (`goto`, `hover`, `click`, `wait`).

   Render it: `node tools/video/render.mjs <plan>` or `node tools/video/screen.mjs <plan>`; check a
   few frames first with `--only 0,90`.
3. **Write the plan.** Copy `tools/video/plans/story-template.json` (the hook, the turn, one idea
   and the question, about 25 s). Each part names its shot (`frames`, `first`, `count`), its slow move
   (`crop` from one box to another), its fade from the part before (`fade`), and its lines (`say`:
   text, the second it starts at within the part, its `row`, `style`). Set `out`.
4. **Build it:** `sh tools/video/story.sh <plan> [shots-dir]`. It writes the lines' cues, types the
   box frame by frame, composes the video and, with a folder, each shot on its own.
5. **Watch it, then tighten it:** too long a gap between two lines, a view that lingers, a line
   that cannot be read before it goes. The rules above are the checklist.

### Sound

`arail-compose` mixes a sound track when the plan has sounds: `sounds` of each part (a file, when it
starts within the part, how long, how loud) and `typing` of the plan (a key-click recording under
every typed line). Use only recordings in the public domain, CC0 or CC BY (and name their authors in
`THIRD_PARTY_NOTICES.md`); share-alike licences would put their terms on the whole video. The
project page's video has no sound yet: Wikimedia Commons, where suitable recordings were found,
refused the downloads from the build environment.
