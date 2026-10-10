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

/** Serve the test scene: the layout (no marker known yet) and its photo. */
export async function routeScene(page) {
  const layout = {
    format: "arail-layout/1", name: SCENE_NAME, scale: 87,
    markers: { dictionary: "ARUCO", size_mm: 30, codes: 50, origin: 0, poses: {} },
    objects: [],
    view: { image: "test-scene.jpg" },
  };
  await page.route("**/layouts/test-scene.json", (route) => route.fulfill({ json: layout }));
  await page.route("**/layouts/test-scene.jpg", (route) => route.fulfill({ path: SCENE_PHOTO, contentType: "image/jpeg" }));
}
