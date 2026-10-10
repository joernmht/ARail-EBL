#!/bin/sh
# Rebuilds the project page's videos from the lab's clips and photos (about an hour):
#   sh tools/video/page-videos.sh
# Needs Node with the dev dependencies (npm install), the Python tools with OpenCV
# (pip install -e "tools[headless]") and ffmpeg. Frames and poses go to build/video/.
set -e
cd "$(dirname "$0")/../.."
render() { node tools/video/render.mjs "tools/video/plans/$1.json"; }

# the town at the curve: raw poses, the stabilized poses, then the frames with them
render town-pass1
arail-stabilize build/video/town-raw.json -o build/video/town-poses.json --motion build/video/town-motion.json \
  --ref=-2000,-300,-500,600 --plane=-2400,-60,6000,640 --plane=-2400,-560,-450,-60 --plane=-2500,640,-100,1480
render town-pass2
# the hybrid terminal (the example's photo, then one frame of the clip beside the truck) and the bus stop
render terminal-photo
render terminal-truck
render bus
# the videos
arail-compose tools/video/plans/landing.json
arail-compose tools/video/plans/terminal-card.json
