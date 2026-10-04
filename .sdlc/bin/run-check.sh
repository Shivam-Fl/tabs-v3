#!/usr/bin/env bash
# One configured check — verify.<key> in .sdlc/config.yml — run as the verdict needs it run:
#
#   bash .sdlc/bin/run-check.sh <prepare|typecheck|lint|unit|build|e2e> <log>
#
# ci-verify judges a PR with it and sdlc-main-verify judges the default branch with it, so the
# two cannot drift into checking different things. The steps were inline in ci-verify, and the
# default branch had no verifier at all.
#
# pipefail is the point. Under `bash -e` alone `eval "$CMD" | tee` exits with tee's 0, and every
# check "passed" for as long as ci-verify ran that way. An unset key is a skip, not a failure.
set -eo pipefail
KEY=$1
LOG=$2
CMD=$(node .sdlc/bin/read-config.mjs "verify.$KEY")
if [ -z "$CMD" ]; then echo "verify.$KEY not configured - skipping"; exit 0; fi
# A stub verify on a branch with code would pass it without running anything.
if [ "$KEY" = unit ]; then node .sdlc/bin/verify-is-real.mjs 2>&1 | tee -a "$LOG"; fi
echo "$ $CMD" | tee -a "$LOG"
eval "$CMD" 2>&1 | tee -a "$LOG"
