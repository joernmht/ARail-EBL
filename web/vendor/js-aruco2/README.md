# Vendored: js-aruco2 2.0.0

Unmodified copies of the files ARail-EBL needs from
[js-aruco2](https://github.com/damianofalcioni/js-aruco2) (npm package `js-aruco2@2.0.0`).
They are vendored so that the app works in lab networks without access to a CDN.

| File | Content | License |
| --- | --- | --- |
| `cv.js`, `aruco.js` | Image processing and marker decoding; includes the ArUco Original and ArUco MIP 36h12 dictionaries | MIT |
| `dictionaries/aruco_*_1000.js` | ArUco 4x4 … 7x7 dictionaries (extracted from OpenCV) | BSD-3-Clause (OpenCV) |
| `dictionaries/apriltag_36h11.js` | AprilTag 36h11 dictionary | BSD-2-Clause (University of Michigan) |

`LICENSE.txt` is the license file shipped with the package. The files `posit1.js`,
`posit2.js` and `svd.js` of the package are **not** included.

To update: `npm pack js-aruco2@<version>`, copy the files listed above, and run `npm test`
(the detector tests compare js-aruco2 against OpenCV for every supported dictionary).
