# Camera bridge

3D-printable parts for filming the lab's trains: a bridge over the tracks and a side stand that hold a phone, and cable troughs for its charging cable. The guide, with printing, hardware, assembly and recording, is [docs/camera-bridge.md](../../docs/camera-bridge.md).

- `camera_bridge.py`: generates the parts; every size is a parameter (`--help`, `--report`).
- `stl/`: the parts for the EBL (two tracks 52 mm apart), as they are printed.
- `requirements.txt`: `manifold3d` and `numpy`.

```bash
pip install -r requirements.txt
python camera_bridge.py --out stl --report
```

After changing the script, write the STL files again: `tests/python/test_camera_bridge.py` checks that they match it.
