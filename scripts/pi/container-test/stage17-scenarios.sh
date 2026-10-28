#!/usr/bin/env bash
# The registration step of Pi stage 17 (scripts/pi/remote/17-gh-runner.sh) in a Debian 13 ARM64 container, with the
# real runuser and a real `ghrunner` user. The stage's own config.sh command is cut out of the script and run from a
# folder the runner user cannot enter (like the ssh login folder, /root), against a stand-in config.sh that behaves
# like GitHub's: it checks its libraries with a relative `ldd ./bin/...` path and fails when the cwd is not its folder
# (live failure 2026-10-28). The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage17-scenarios.sh
# (scripts/pi/gh-runner.test.mjs runs it with PI_STAGE17_CONTAINER=1.)
#
# DESTRUCTIVE: it adds a user and /opt/gh-runner. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE="${STAGE:-/repo/scripts/pi/remote/17-gh-runner.sh}" # STAGE: another copy of the script, to check the scenarios catch the old bug
RUNNER_USER=ghrunner
dir=/opt/gh-runner/vault
reg=/tmp/vault.reg
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

useradd --system --no-create-home --shell /usr/sbin/nologin "$RUNNER_USER"
install -d -m 0750 -o "$RUNNER_USER" -g "$RUNNER_USER" "$dir" "$dir/bin" "$dir/home" "$dir/_work"
touch "$dir/bin/libcoreclr.so"
chown "$RUNNER_USER" "$dir/bin/libcoreclr.so"
printf 'token-value\n' >"$reg"

cat >"$dir/config.sh" <<'EOF'
#!/usr/bin/env bash
# Like GitHub's config.sh: a relative path to its own bin folder.
[ -e ./bin/libcoreclr.so ] || { echo "ldd: ./bin/libcoreclr.so: No such file or directory" >&2; exit 1; }
[ "${ACTIONS_RUNNER_INPUT_TOKEN:-}" = "token-value" ] || exit 2
touch .runner
EOF
chmod 0755 "$dir/config.sh"
chown "$RUNNER_USER" "$dir/config.sh"

# The stage's registration command, as the script has it (from the token line to the die message).
snippet="$(sed -n '/^    ACTIONS_RUNNER_INPUT_TOKEN=/,/die "registering runner/p' "$STAGE")"
[ -n "$snippet" ] || { echo "FAIL: registration command not found in the stage"; exit 1; }

run_from() {
  rm -f "$dir/.runner"
  (
    cd "$1" || exit 1
    RUNNER_USER=$RUNNER_USER dir=$dir reg=$reg GH_OWNER=Gnuminator repo=obsidian-vault name=vault
    die() { echo "die: $*" >&2; exit 1; }
    eval "$snippet"
  )
}

# 1. from /root (mode 700, closed to the runner user): registers.
chmod 700 /root
if run_from /root >/tmp/out1 2>&1 && [ -f "$dir/.runner" ]; then pass "registers when started from a folder the runner cannot enter"; else
  fail "register from /root"
  cat /tmp/out1
fi
# 2. from the runner folder itself and from /: the same.
for d in "$dir" /; do
  if run_from "$d" >/tmp/out2 2>&1 && [ -f "$dir/.runner" ]; then pass "registers when started from $d"; else
    fail "register from $d"
    cat /tmp/out2
  fi
done
# 3. the token never reaches the output.
grep -q token-value /tmp/out1 /tmp/out2 && fail "token in output" || pass "token not in output"

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
