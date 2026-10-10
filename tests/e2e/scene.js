// The test scene of the fixtures (`npm run fixtures`, tools/arail_tools/synthetic.py): a board with
// ArUco markers 0–7, its photo and a survey video. The app gets it as a layout with an empty marker
// map, /layouts/test-scene.json, and its photo; the routes serve both from the test.
import { existsSync } from "node:fs";

export const SCENE_PHOTO = "tests/fixtures/scene.jpg";
export const SCENE_VIDEO = "tests/fixtures/synthetic-survey.webm"; // WebM: test browsers lack H.264
/** The layout's URL from the app (app/?layout=…). */
export const SCENE = "../layouts/test-scene.json";
export const SCENE_NAME = "Test scene";
export const hasScene = () => existsSync(SCENE_PHOTO) && existsSync(SCENE_VIDEO);

/**
 * A route matcher for a path on the test server. (A glob like "**\/layouts/x.json" would also
 * match the app's own address, app/?layout=../layouts/x.json.)
 */
export const atPath = (path) => (url) => url.pathname === path;

/** Serve the test scene: the layout (no marker known yet) and its photo. */
export async function routeScene(page) {
  const layout = {
    format: "arail-layout/1", name: SCENE_NAME, scale: 87,
    markers: { dictionary: "ARUCO", size_mm: 30, codes: 50, origin: 0, poses: {} },
    // the board's two platforms between their markers, and a few things placed at markers 6 and 7
    objects: [
      { id: "table-board", type: "tabletop", name: "Test board", kind: "physical", position: [270, -70], width_mm: 800, depth_mm: 500 },
      { id: "platform-1", type: "platform", name: "Platform 1", number: "1", between: [0, 1], width_mm: 70, sides: "both" },
      { id: "platform-2", type: "platform", name: "Platform 2", number: "2", between: [2, 3], width_mm: 37, sides: "both" },
      { id: "bus-terminal-1", type: "bus-terminal", name: "Bahnhof", position: { marker: 6, offset: [242.5, -240] }, rotation_deg: 0, bays: 2, lines: "305" },
      { id: "building-1", type: "building", name: "House", position: { marker: 6, offset: [90, -550] }, width_m: 9, depth_m: 5, floors: 2 },
      { id: "building-2", type: "building", name: "House", position: { marker: 6, offset: [235, -550] }, width_m: 9, depth_m: 5, floors: 3, roof: "flat" },
      { id: "tree-1", type: "tree", position: { marker: 6, offset: [10, -555] }, height_m: 10 },
      { id: "tree-2", type: "tree", position: { marker: 7, offset: [-40, -560] }, kind: "conifer", height_m: 12 },
    ],
    view: { image: "test-scene.jpg" },
  };
  await page.route(atPath("/layouts/test-scene.json"), (route) => route.fulfill({ json: layout }));
  await page.route(atPath("/layouts/test-scene.jpg"), (route) => route.fulfill({ path: SCENE_PHOTO, contentType: "image/jpeg" }));
}
