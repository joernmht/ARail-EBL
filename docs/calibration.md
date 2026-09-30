# Camera calibration

Calibration is optional. ARail estimates the camera's focal length from the markers and works with phones and most webcams without it. Calibrate when

- a wide-angle webcam bends straight edges near the image border (lens distortion), or
- people and buildings lean near the border of the image even after adjusting the focal length.

A calibration belongs to one camera and one image shape (aspect ratio). The app scales it to other resolutions of the same shape and ignores it otherwise.

## With the layout's markers

No calibration board is needed: every marker is a small calibration target.

```bash
pip install -e "tools[opencv]"          # desktop OpenCV with windows
arail-calibrate --camera 0 --width 1280 --height 720
```

Move one or more markers (flat on cardboard) in front of the camera, or move the camera over the layout:

- tilt them 30–60° in different directions,
- cover the whole image, including borders and corners (the dots show where views were taken),
- markers at least about 40 px large.

**Space** captures the usable markers (green), **A** captures automatically, **C** computes and saves after 40 views, **Q** quits. A reprojection error below 0.5 px is good; above 1 px, collect more tilted views.

For a phone camera, take 15–30 photos of markers (tilted, near the image borders, same resolution as later) and run

```bash
arail-calibrate --images photos/*.jpg --output phone-calibration.json
```

## Using it

In the app: **View → Camera → Load calibration**. The calibration is kept in the browser; **Remove calibration** returns to the estimate.

The file (format `arail-camera/1`):

```json
{
  "format": "arail-camera/1",
  "image_size": [1280, 720],
  "camera_matrix": [[948.2, 0, 640], [0, 948.2, 360], [0, 0, 1]],
  "distortion": [-0.241, 0.071, 0, 0, 0],
  "rms_px": 0.31,
  "views": 64
}
```

`distortion` uses OpenCV's model (k1, k2, p1, p2, k3). The calibration fixes the principal point at the image centre, square pixels and no tangential distortion, which is stable with small targets. ARail removes the distortion from detected marker corners and applies it again when drawing, so virtual objects follow the curved image.
