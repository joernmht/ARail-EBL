#!/bin/sh
# Builds a short video from a story plan (docs/short-videos.md): the lines' cues, the terminal box
# typed frame by frame, the video with its lines (and its sounds, where the plan has some), and,
# with a second argument, each shot on its own without lines or sound.
#   sh tools/video/story.sh tools/video/plans/hero.json [shots-dir]
# The shots the plan names must be rendered first (render.mjs, screen.mjs; see the plan's parts).
set -e
[ -n "$1" ] || { echo "usage: sh tools/video/story.sh <plan.json> [shots-dir]" >&2; exit 2; }
# the paths as the caller gave them, made absolute before going to the repository
abs() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$(pwd)" "$1" ;; esac; }
plan=$(abs "$1")
shots=""
[ -z "$2" ] || shots=$(abs "$2")
cd "$(dirname "$0")/../.."
name=$(basename "$plan" .json)
arail-compose "$plan" --cues "build/video/$name-cues.json"
node tools/video/typewriter.mjs "build/video/$name-cues.json" "$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['overlay'])" "$plan")"
arail-compose "$plan"
[ -z "$shots" ] || arail-compose "$plan" --shots "$shots"
