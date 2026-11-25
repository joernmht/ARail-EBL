// The Overview's figures (web/app/overview.js): measured every 400 ms while it is open, the town's
// trips from door to door are worked out again only when a trip has ended, not each time.
import assert from "node:assert/strict";
import test from "node:test";

import { createWorld } from "../../web/arail/index.js";
import { Overview } from "../../web/app/overview.js";

test("the Overview goes through the town's trips again only when one has ended", () => {
  const world = createWorld({ simulations: [{ type: "town" }] });
  const town = world.simulations.find((s) => s.constructor.type === "town");
  const tripStats = town.tripStats.bind(town);
  let walks = 0;
  town.tripStats = () => {
    walks++;
    return tripStats();
  };
  const overview = new Overview({ world, feed: null, tracker: null, source: null });
  const trips = () => overview.measures().find((m) => m.id === "trips");
  for (let i = 0; i < 5; i++) assert.equal(trips().note, "No trip finished yet");
  assert.equal(walks, 1, "five updates, the trips gone through once");
  // a trip that did not reach its building (gone home instead): counted again, not among the trips
  town.tripLog.push({ id: "a", groups: ["all"], end: "home", minutes: 12, parts: {} });
  trips();
  trips();
  assert.equal(walks, 2, "a trip ended: once more");
  // the log keeps the latest trips: full, its length stays while trips come and go
  town.tripLog.shift();
  town.tripLog.push({ id: "b", groups: ["all"], end: "home", minutes: 9, parts: {} });
  trips();
  assert.equal(walks, 3, "another last trip, as many as before");
  trips();
  assert.equal(walks, 3);
});
