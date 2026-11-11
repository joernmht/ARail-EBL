# The cast's portraits

Who speaks in the game is shown as a portrait beside what they say. The files here are
**placeholders**: silhouettes, one per kind of person (`office`, `suit`, `hivis`, `uniform`,
`headset`). To put pictures in their place:

- **A kind of person**: put the picture here and name it in `PORTRAITS` in `../cast.js`
  (`picture`, and `alt`: what it shows).
- **One person**: put the picture in `people/` and name it in `FACES` in `../cast.js`, by the
  person's name as the game shows it (`"E. Kiebitz": { picture: "game/cast/people/e-kiebitz.webp", alt: "…" }`).
  A person without a picture of their own keeps the portrait of their kind.

What fits: a bust (head and shoulders) facing the viewer or slightly to the right, 3:4 upright,
about 600 × 800 px, with a transparent background (WebP or PNG), cut off straight at the bottom. The
stage shows it up to 200 px wide at the lower left, the seats' faces as circles of 34 to 40 px
(cut from the upper part, so the face should sit in the upper half).

People in the game have bird names (`web/arail/core/people.js`); pictures must not show real,
recognisable people without their consent.
