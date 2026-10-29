#!/usr/bin/env bash
# Render the Demo composition in 10-second chunks, each in a fresh process,
# then join them. One long render stalled for hours on the 4 GB laptop;
# short ones don't. A chunk that stalls is killed and tried again.
#
#   video/render_demo.sh   → video/out/demo_remotion.mp4
set -euo pipefail
cd "$(dirname "$0")"
CHROME=/usr/bin/google-chrome
PARTS=out/demo_parts
CHUNK=300

# The recordings, cropped to the page at a constant 30 fps with a keyframe a
# second: GNOME's variable-rate files with a keyframe every ~3 s made frame
# seeking stall.
mkdir -p out/rec30
for f in out/rec/*.mp4; do
  [[ -s out/rec30/$(basename "$f") ]] || ffmpeg -y -loglevel error -i "$f" \
    -vf "crop=1276:573:78:183,fps=30" -c:v libx264 -preset veryfast -crf 16 -g 30 \
    -pix_fmt yuv420p -an "out/rec30/$(basename "$f")"
done

npx remotion bundle src/index.ts --out-dir=build --log=error
# frames = 30 × the scenes' seconds
TOTAL=$(grep -o 'seconds: [0-9]*' src/demo/scenes.ts | awk '{n += $2} END {print n * 30}')
# One chunk, in its own process group: on a stall the whole group is killed.
# `timeout` alone kills only npx, and the orphaned renderers piled up until
# the out-of-memory killer stepped in.
run_chunk() {
  setsid npx remotion render build Demo "$1" --frames="$2" \
    --browser-executable=$CHROME --concurrency=2 --log=error &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2; waited=$((waited + 2))
    if ((waited >= 180)); then
      kill -- -"$pid" 2>/dev/null; sleep 2; kill -9 -- -"$pid" 2>/dev/null
      wait "$pid" 2>/dev/null; return 1
    fi
  done
  wait "$pid"
}

mkdir -p "$PARTS"
: > "$PARTS/list.txt"
for ((start = 0; start < TOTAL; start += CHUNK)); do
  end=$((start + CHUNK - 1)); ((end >= TOTAL)) && end=$((TOTAL - 1))
  out="$PARTS/$(printf %05d "$start").mp4"
  echo "file '$(basename "$out")'" >> "$PARTS/list.txt"
  [[ -s "$out" ]] && continue  # done in an earlier run
  for try in 1 2 3 4; do
    echo "frames $start-$end (try $try)"
    if run_chunk "$out.tmp.mp4" "$start-$end"; then
      mv "$out.tmp.mp4" "$out"; break
    fi
  done
  [[ -s "$out" ]] || { echo "chunk $start failed"; exit 1; }
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$PARTS/list.txt" -c copy out/demo_remotion.mp4
rm -rf "$PARTS" build
echo "done: out/demo_remotion.mp4"
