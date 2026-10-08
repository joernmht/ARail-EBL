/**
 * Models of the architecture page: the camera tools (Python) and the Node tools. See ../model.js.
 * @module architecture/models/tools
 */
export const TOOLS = [
  {
    id: "offline-survey", group: "tools", title: "Surveying a layout (arail-survey)",
    summary: "From videos or photos of the layout: every marker's position by a bundle adjustment with one homography per frame, a locked marker map in the layout file, a report, and an orthophoto of the table.",
    files: ["tools/arail_tools/survey.py", "tools/arail_tools/aruco.py", "tools/arail_tools/__init__.py"],
    classes: [
      { name: "MarkerDetector", file: "tools/arail_tools/aruco.py", kind: "class", role: "OpenCV's ArUco detection for the tools.", operations: ["detect(grey)", "_find(name, grey)"] },
      { name: "SurveyDetector", file: "tools/arail_tools/survey.py", kind: "class", extends: "MarkerDetector", role: "Corners refined without bias; duplicates and IDs beyond the codes counted.", operations: ["detect(grey)"] },
      { name: "Adjustment", file: "tools/arail_tools/survey.py", kind: "class", role: "Sparse Levenberg–Marquardt with the Schur complement.", operations: ["solve(delta, max_iter)", "cost(poses, Hn)", "covariance()", "observation_rms()"] },
      { name: "SurveyResult", file: "tools/arail_tools/survey.py", kind: "class", role: "Poses, status, statistics, warnings.", operations: ["pose_json(m)"] },
      { name: "survey", file: "tools/arail_tools/survey.py", kind: "module", role: "The command.", attributes: ["FORMAT — \"arail-survey/1\""], operations: ["run(args, log)", "detect_frames(sources, detector, every)", "survey(frames, size_mm, sizes_mm)", "chain_round(frames, known, size_of, rejected)", "orthophoto(result, sources)", "layout_json(result, base)"] },
    ],
    relations: [
      { from: "survey", to: "Adjustment", kind: "creates" },
      { from: "survey", to: "SurveyResult", kind: "creates" },
      { from: "survey", to: "SurveyDetector", kind: "uses" },
    ],
    activities: [{
      id: "run", name: "arail-survey",
      nodes: [
        ["s", "start"],
        ["a1", "action", "The layout (if given): codes, dictionary, fixed markers", "run"],
        ["a2", "action", "Markers in every 2nd frame, corners refined", "detect_frames"],
        ["a3", "action", "Markers that moved between videos left out", "survey"],
        ["d1", "decision", "Two fixed markers seen?"],
        ["a4", "action", "A free adjustment, compared with the layout's positions", "survey"],
        ["m1", "merge"],
        ["a5", "action", "Chain new markers in, adjust, reject bad frames (≤ 5 rounds)", "chain_round"],
        ["a6", "action", "Uncertainty of every marker; misreads; warnings", "Adjustment.covariance"],
        ["d2", "decision", "Orthophoto asked for?"],
        ["a7", "action", "The orthophoto of the table", "orthophoto"],
        ["m2", "merge"],
        ["a8", "action", "A locked layout file and the report", "layout_json"],
        ["e", "end"],
      ],
      edges: [["s", "a1"], ["a1", "a2"], ["a2", "a3"], ["a3", "d1"], ["d1", "a4", "yes"], ["d1", "m1", "no"], ["a4", "m1"], ["m1", "a5"], ["a5", "a6"], ["a6", "d2"], ["d2", "a7", "yes"], ["d2", "m2", "no"], ["a7", "m2"], ["m2", "a8"], ["a8", "e"]],
    }],
    parameters: [
      { key: "--every", default: "2", meaning: "Every n-th frame." },
      { key: "--size, --codes, --origin", default: "30 mm, 50, 0", meaning: "The markers." },
      { key: "--moved-mm", default: "5", meaning: "A marker that moved more is left out." },
      { key: "--ortho-res", default: "1 mm/px", meaning: "Resolution of the orthophoto." },
    ],
    rules: ["Frames with an error over max(4 px, 6 × the median) are rejected.", "Moved: more than max(5 mm, 4 σ), with at least 3 markers.", "On the synthetic test video the markers are placed within 2 mm and 0.5°."],
  },
  {
    id: "calibration", group: "tools", title: "Camera calibration (arail-calibrate)",
    summary: "Each marker is a target of four points: from photos or a live camera, OpenCV's calibration gives the focal length and lens distortion of a wide-angle webcam; the app and arail-survey load the file.",
    files: ["tools/arail_tools/calibrate.py"],
    classes: [{ name: "calibrate", file: "tools/arail_tools/calibrate.py", kind: "module", role: "The command.", attributes: ["FORMAT — \"arail-camera/1\"", "MIN_VIEWS — 40"], operations: ["main(argv)", "calibrate_images(paths, detector, marker_size, output)", "calibrate_live(args, detector)", "compute(views, image_size, marker_size)", "to_json(rms, K, dist, image_size, views, camera)"] }],
    relations: [{ from: "calibrate", to: "MarkerDetector", kind: "uses" }],
    activities: [{
      id: "calibrate", name: "Calibrating a camera",
      nodes: [
        ["s", "start"],
        ["d1", "decision", "Photos given?"],
        ["a1", "action", "The usable views of each photo", "calibrate_images"],
        ["d2", "decision", "At least 12 views?"],
        ["a2", "action", "Live: views until 40", "calibrate_live"],
        ["m1", "merge"],
        ["a3", "action", "OpenCV's calibration (principal point and aspect fixed)", "compute"],
        ["a4", "action", "camera-calibration.json", "to_json"],
        ["a5", "action", "The app loads it (View → Camera)", "Camera.setCalibration"],
        ["e", "end"],
        ["f", "flowfinal"],
      ],
      edges: [["s", "d1"], ["d1", "a1", "yes"], ["d1", "a2", "no"], ["a1", "d2"], ["d2", "f", "no"], ["d2", "m1", "yes"], ["a2", "m1"], ["m1", "a3"], ["a3", "a4"], ["a4", "a5"], ["a5", "e"]],
    }],
    parameters: [{ key: "--marker-size", default: "30 mm", meaning: "Edge of the printed markers." }],
    rules: ["The app ignores a calibration whose aspect ratio differs by more than 2 %."],
  },
  {
    id: "test-scenes", group: "tools", title: "Synthetic scenes and test fixtures",
    summary: "A synthetic H0 scene rendered with a known camera, marker strips, the lab photo and a short video: the images the tests use (npm run fixtures).",
    files: ["tools/arail_tools/synthetic.py", "tools/arail_tools/fixtures.py"],
    classes: [
      { name: "synthetic", file: "tools/arail_tools/synthetic.py", kind: "module", role: "The scene.", operations: ["marker_poses_layout()", "texture(dictionary)", "camera_pose(k)", "render(tex, k, hidden)", "hidden_markers(k)"] },
      { name: "fixtures", file: "tools/arail_tools/fixtures.py", kind: "module", role: "Writes tests/fixtures.", operations: ["main(argv)", "write_rgba(img, path)", "detect(img, dictionary)", "marker_bits(dictionary, mid)"] },
    ],
    relations: [{ from: "fixtures", to: "synthetic", kind: "depends" }],
  },
  {
    id: "node-tools", group: "tools", title: "Node tools",
    summary: "The development server, fetching the fonts, and comparing operations setups on the command line.",
    files: ["tools/serve.mjs", "tools/fetch-fonts.mjs", "tools/ops-compare.mjs"],
    classes: [],
    rules: ["serve.mjs serves web/ (the tests start it on port 8123).", "ops-compare.mjs runs the setups of a layout's rail operations under stress tests (runExperiment) and writes CSV."],
  },
];
