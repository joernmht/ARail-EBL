#!/bin/sh
# Rebuilds the project page's videos from the lab's clips and photos (half an hour or more):
#   sh tools/video/page-videos.sh
# Needs Node with the dev dependencies (npm install), the Python tools with OpenCV
# (pip install -e "tools[headless]") and ffmpeg. Frames, poses and clips go to build/video/.
set -e
cd "$(dirname "$0")/../.."
render() { node tools/video/render.mjs "tools/video/plans/$1.json"; }

# the clips of the station and the container train at 1280 px (the browser of the render loads the
# whole clip; at full size the station clip is too large for it), the station's first 6 s only
mkdir -p build/video/clips
ffmpeg -v error -y -i examples/media/ebl-station-trains.mp4 -t 6 -vf scale=1280:720 -an -c:v libx264 -crf 14 -preset fast build/video/clips/station-trains-720.mp4
ffmpeg -v error -y -i examples/media/ebl-terminal-wagons.mp4 -vf scale=1280:720 -an -c:v libx264 -crf 14 -preset fast build/video/clips/terminal-wagons-720.mp4

# the town at the curve: raw poses, the stabilized poses, then the frames with them
render town-pass1
arail-stabilize build/video/town-raw.json -o build/video/town-poses.json --motion build/video/town-motion.json \
  --ref=-2000,-300,-500,600 --plane=-2400,-60,6000,640 --plane=-2400,-560,-450,-60 --plane=-2500,640,-100,1480
render town-pass2
# Bf Neustadt, the walk along the container train, and the hybrid terminal (the example's photo,
# then one frame of the clip beside the truck)
render station
render terminal-wagons
render terminal-photo
render terminal-truck
# the videos
arail-compose tools/video/plans/hero.json
arail-compose tools/video/plans/terminal-card.json
