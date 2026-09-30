"""ArUco marker detection with OpenCV (used by the calibration tool and the tests)."""

from __future__ import annotations

import numpy as np

try:
    import cv2
except ImportError as exc:  # pragma: no cover - depends on the installation
    raise SystemExit("OpenCV is required: pip install -e 'tools[opencv]' (or [headless])") from exc

# Dictionaries tried when detecting automatically (same set as the web app)
DICTIONARIES = [
    "DICT_4X4_50",
    "DICT_5X5_50",
    "DICT_6X6_50",
    "DICT_7X7_50",
    "DICT_ARUCO_ORIGINAL",
    "DICT_ARUCO_MIP_36h12",
    "DICT_APRILTAG_36h11",
]


def marker_corners_mm(size: float) -> np.ndarray:
    """Marker corners in the marker frame (mm): top-left, top-right, bottom-right, bottom-left."""
    h = size / 2.0
    return np.array([[-h, h], [h, h], [h, -h], [-h, -h]], np.float32)


def _parameters():
    p = cv2.aruco.DetectorParameters()
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    p.cornerRefinementWinSize = 3  # small window: markers are small in the image
    return p


class MarkerDetector:
    """Finds markers; with ``dictionary=None`` the dictionary is found by voting over frames."""

    def __init__(self, dictionary: str | None = "DICT_ARUCO_ORIGINAL", max_id: int = 49):
        self.params = _parameters()
        self.max_id = max_id
        self.candidates = [n for n in DICTIONARIES if hasattr(cv2.aruco, n)]
        self.votes = {n: 0 for n in self.candidates}
        self._detectors: dict = {}
        self.name = None
        if dictionary and dictionary != "auto":
            if not hasattr(cv2.aruco, dictionary):
                raise SystemExit(f"Unknown dictionary: {dictionary}")
            self.name = dictionary

    def _detector(self, name):
        if name not in self._detectors:
            d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, name))
            self._detectors[name] = cv2.aruco.ArucoDetector(d, self.params)
        return self._detectors[name]

    def _find(self, name, grey) -> dict[int, np.ndarray]:
        corners, ids, _ = self._detector(name).detectMarkers(grey)
        found = {}
        if ids is not None:
            for c, i in zip(corners, ids.flatten(), strict=True):
                i = int(i)
                if i <= self.max_id and i not in found:
                    found[i] = c.reshape(4, 2).astype(np.float64)
        return found

    def detect(self, grey: np.ndarray) -> dict[int, np.ndarray]:
        """Marker ID -> 4x2 image corners (TL, TR, BR, BL)."""
        if grey.ndim == 3:
            grey = cv2.cvtColor(grey, cv2.COLOR_BGR2GRAY)
        if self.name:
            return self._find(self.name, grey)
        best, best_name = {}, None
        for n in self.candidates:
            f = self._find(n, grey)
            if len(f) > len(best):
                best, best_name = f, n
        if best_name:
            self.votes[best_name] += len(best)
            if self.votes[best_name] >= 6:
                self.name = best_name
        return best
