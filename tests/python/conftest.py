import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# make `import arail_tools` work without installing the package
sys.path.insert(0, os.path.join(ROOT, "tools"))
