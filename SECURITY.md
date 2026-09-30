# Security policy

## Reporting a vulnerability

Please do not report security problems in public issues. Use GitHub's private reporting instead: **Security → Report a vulnerability** in this repository. You will get an answer within two weeks. If private reporting is not available, contact the maintainers (currently @joernmht) using the contact details on their GitHub profile.

## Scope

The parts of ARail-EBL that deserve most attention:

- **The bridge** (`arail-bridge`) is a network service. It listens on localhost by default, only sends data to the apps, and never sends commands to the control system. When it is opened to a network (`--host 0.0.0.0`), use `--origin` and TLS, and keep it inside the lab network.
- **Plugins** are JavaScript modules loaded by layout files. The app only loads plugins from its own origin. Only open layout files you trust.
- **The web app** runs entirely in the browser. Camera images are processed locally and are never uploaded.

## Supported versions

Security fixes are made for the latest version on the `main` branch.
