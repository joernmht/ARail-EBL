# arail-tools

Python tools for [ARail-EBL](https://github.com/joernmht/ARail-EBL):

| Command | What it does | Extra |
| --- | --- | --- |
| `arail-bridge` | connects a control system to the ARail web app (WebSocket feed) | `bridge` |
| `arail-calibrate` | camera calibration with the layout's markers, JSON output for the app | `opencv` |
| `arail-synthetic` | renders the synthetic test layout | `opencv` or `headless` |
| `python -m arail_tools.fixtures` | generates the images for the JavaScript tests | `opencv` or `headless` |

```bash
pip install -e "tools[bridge]"                 # only the bridge
pip install -e "tools[opencv,bridge]"          # everything, with OpenCV windows (desktop)
pip install -e "tools[headless,bridge,dev]"    # servers, CI, development
```

Install either `opencv` or `headless`, not both. See the documentation:
[control-system interface](../docs/control-system-interface.md), [calibration](../docs/calibration.md).
