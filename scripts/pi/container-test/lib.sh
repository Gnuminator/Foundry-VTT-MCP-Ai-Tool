#!/usr/bin/env bash
# Sourced by every scenario script in this folder (a test checks it): the result helpers, the counter and the guard
# that keeps a destructive scenario script off a real machine. Source it first, right after `set -uo pipefail`:
#   . "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }
# The `|| exit` matters: a script run without its folder (copied alone, fed on stdin) must refuse, not go on.
# It sets no shell options. The apt packages the scenarios need are in the image (Dockerfile next to this file), not
# installed per run.

fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# Scenario scripts that wipe folders or add users call this first; they run only in the test container.
require_test_container() {
  [ -f /.dockerenv ] || [ -n "${container:-}" ] || {
    echo "REFUSED: run this only in the test container (docker run ..., see the header)"
    exit 98
  }
}
