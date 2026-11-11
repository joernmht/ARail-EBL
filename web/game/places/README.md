# The game's pictures of places

The pictures behind the game's pages (`../places.js` names them):

- **Close-ups of the lab** (`signal-box.jpg`, `track.jpg`, `district.jpg`, `lab-trains.jpg`,
  `terminal.jpg`): cut from the lab's photos in `web/media/` and `web/assets/`. Each names its whole
  photo as `wide` in `places.js`, which is what fills a screen.
- **Virtual close-ups** (`*-fly.jpg`): taken in the app's flyover, by day and at night, without the
  table's photo (it blurs when the camera comes close). `node tools/game-places.mjs` takes them
  again (all, or the ones named) from the camera positions in its `SHOTS`; run it after a layout has
  changed, with the site running (`npm start`).

A new picture: a line in `SHOTS` of `tools/game-places.mjs` (for a virtual one), and an entry in
`PLACES` (a place where a role works) or `BACKDROPS` (a picture for what a question is about, with
the words it fits) in `../places.js`. Pictures are 16:9, 1440 × 810 px.
