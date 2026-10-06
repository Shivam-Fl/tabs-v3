#!/usr/bin/env bash
# Records the implementer's demo script against one checkout of the product:
#
#   bash .sdlc/bin/pr-demo-record.sh <before|after> <app dir> <spec> <out dir>
#
# Run by the demo job in sdlc-implement, which holds no write token and runs no agent: it installs
# and boots the product the way QA does (env.boot, wait-ready), runs the spec with the framework's
# Playwright config (video and screenshot on), stops the app, and keeps for each scenario its video
# as <name>.mp4 and its last frame as <name>.png. Nothing here can fail the job: a base the demo
# cannot walk (the screen is new in this PR) is a "before" with nothing to show, not an error.
set -uo pipefail
SIDE=$1
APP=$2
SPEC=$3
OUT=$4
ROOT=$PWD
RUN="${RUNNER_TEMP:-/tmp}/demo-$SIDE"
mkdir -p "$OUT"

URL=$(node .sdlc/bin/read-config.mjs env.base_url)
BOOT=$(node .sdlc/bin/read-config.mjs env.boot)
[ -n "$URL" ] && [ -n "$BOOT" ] || { echo "env.base_url or env.boot is not set: nothing to record"; exit 0; }

(cd "$APP" && bash "$ROOT/.sdlc/bin/install-deps.sh") > "$RUN.install.log" 2>&1 \
  || { echo "the $SIDE checkout did not install: nothing recorded for it"; tail -20 "$RUN.install.log"; exit 0; }
setsid nohup bash -c "cd '$APP' && $BOOT" > "$RUN.app.log" 2>&1 &
PID=$!
stop() { kill -- -"$PID" 2>/dev/null; sleep 2; kill -9 -- -"$PID" 2>/dev/null; true; }
if ! APP_DIR="$APP" node .sdlc/bin/wait-ready.mjs --url "$URL"; then
  echo "the $SIDE app never answered: nothing recorded for it"; tail -20 "$RUN.app.log"; stop; exit 0
fi

rm -rf qa-run/tests && mkdir -p qa-run/tests && cp "$SPEC" "qa-run/tests/$(basename "$SPEC")"
QA_EVIDENCE_DIR="$RUN" PREVIEW_URL="$URL" DEMO_URL="$URL" \
  qa-run/node_modules/.bin/playwright test -c qa-run/playwright.config.mjs \
  || echo "the demo did not pass on $SIDE — expected where the change is new"
stop

# Named from each test's title in the run's JSON report (lib/pr-demo.js recordedTests).
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { recordedTests } from "./.sdlc/bin/lib/pr-demo.js";
  let report; try { report = JSON.parse(readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
  for (const t of recordedTests(report)) console.log([t.name, t.video ?? "", t.shot ?? ""].join("\t"));
' "$RUN/results.json" | while IFS=$'\t' read -r name video shot; do
  if [ -n "$video" ] && [ -f "$video" ]; then
    # -nostdin: ffmpeg otherwise reads this loop's input and the next scenarios vanish.
    ffmpeg -nostdin -loglevel error -y -t 30 -i "$video" -c:v libx264 -pix_fmt yuv420p \
      -vf "scale=1280:-2" -movflags +faststart "$OUT/$name.mp4" || rm -f "$OUT/$name.mp4"
  fi
  if [ -n "$shot" ] && [ -f "$shot" ]; then cp "$shot" "$OUT/$name.png"; fi
done
ls -la "$OUT"
