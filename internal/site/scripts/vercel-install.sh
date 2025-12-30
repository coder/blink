#!/usr/bin/env bash
# cd to the root of the project
cd "$(dirname "$0")/../../../"

set -euo pipefail

# The Vercel build cache loves to keep this around, and then it causes problems.
rm -rf vendor/blink/
: "${SUBMODULE_PAT_TOKEN:?SUBMODULE_PAT_TOKEN env var must be set}"
git config --global url."https://${SUBMODULE_PAT_TOKEN}@github.com/".insteadOf "https://github.com/"
git submodule sync --recursive
git submodule update --init --recursive --depth 1
cd packages/site/
bun install
