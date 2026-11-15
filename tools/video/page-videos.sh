#!/bin/sh
# Rebuilds the project page's videos from the lab's clips, photos and pages (about an hour):
#   sh tools/video/page-videos.sh
# Needs Node with the dev dependencies (npm install), the Python tools with OpenCV
# (pip install -e "tools[headless]") and ffmpeg. Frames, poses and clips go to build/video/.
set -e
cd "$(dirname "$0")/../.."
render() { node tools/video/render.mjs "tools/video/plans/$1.json"; }

# the clips of the station and the container train at 1280 px (the browser of the render loads the
# whole clip; at full size the station clip is too large for it), the station's clip in two parts
mkdir -p build/video/clips
ffmpeg -v error -y -i examples/media/ebl-station-trains.mp4 -t 6 -vf scale=1280:720 -an -c:v libx264 -crf 14 -preset fast build/video/clips/station-trains-720.mp4
ffmpeg -v error -y -ss 5 -i examples/media/ebl-station-trains.mp4 -t 5 -vf scale=1280:720 -an -c:v libx264 -crf 14 -preset fast build/video/clips/station-trains-720b.mp4
ffmpeg -v error -y -i examples/media/ebl-terminal-wagons.mp4 -vf scale=1280:720 -an -c:v libx264 -crf 14 -preset fast build/video/clips/terminal-wagons-720.mp4

# the town at the curve: raw poses, the stabilized poses, then the frames with them
render town-pass1
arail-stabilize build/video/town-raw.json -o build/video/town-poses.json --motion build/video/town-motion.json \
  --ref=-2000,-300,-500,600 --plane=-2400,-60,6000,640 --plane=-2400,-560,-450,-60 --plane=-2500,640,-100,1480
render town-pass2
# frames of the clips held: Bf Neustadt (three), the container train (two), beside the truck; the
# terminal at the crane and the hybrid terminal's photo; the photos of the photo map (plans/photos/)
for p in station station-b station-c terminal-wagons terminal-wagons-0 terminal-truck crane-terminal terminal-photo; do render $p; done
for f in tools/video/plans/photos/*.json; do node tools/video/render.mjs "$f"; done
# the flyover: the bikes, the travellers on the platforms, trams and buses, the night, the whole town; the game page's title and
# the big game's missions, recorded as they are used
for p in bikes platform-people platform-people-2 trams-buses night-town night-station city-wide; do render $p; done
for f in tools/video/plans/screens/*.json; do node tools/video/screen.mjs "$f"; done
# the story (its lines typed into the terminal box), then the terminal card's video
sh tools/video/story.sh tools/video/plans/hero.json
arail-compose tools/video/plans/terminal-card.json
# each shot of the project page's video on its own, without lines or sound, to combine them again:
#   arail-compose tools/video/plans/hero.json --shots <dir>
