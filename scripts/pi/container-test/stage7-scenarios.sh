#!/usr/bin/env bash
# The dashboard.env step of Pi stage 7 (scripts/pi/remote/7-vault.sh) in a Debian 13 ARM64 container, with the real
# lib.sh: Foundry's address for the GM's browser (DASHBOARD_FOUNDRY_URL, the initiative ribbon's portraits). The stage's
# own text is cut out (from the address lookup to the chown of the two env files) and run for each scenario:
#   1 no value and no file: no line in dashboard.env, a warning, the vault name still there
#   2 a value given: the line is written
#   3 a rerun without the value keeps the earlier one
#   4 a value with a path, a trailing slash or a quote is refused and the file stays as it was
#   5 a new value replaces the old one
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage7-scenarios.sh
# (scripts/pi/stage7-foundry-url.test.mjs runs it with PI_STAGE7_CONTAINER=1.) STAGE=<file> runs the scenarios against
# another copy of the script (the old one, to see them fail).
#
# DESTRUCTIVE: it adds a user and writes /etc/foundry-ai-tool. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE="${STAGE:-/repo/scripts/pi/remote/7-vault.sh}"
LIB=/repo/scripts/pi/remote/lib.sh
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

# From the address lookup to the chown of the env files (the old script has no lookup: start at the bridge's output).
snippet="$(sed -n '/^# Foundry.s address for the GM.s browser/,/^chown "root:\$FOUNDRY_USER"/p' "$STAGE")"
[ -n "$snippet" ] || snippet="$(sed -n '/^say "the bridge.s Obsidian output"/,/^chown "root:\$FOUNDRY_USER"/p' "$STAGE")"
[ -n "$snippet" ] || { echo "FAIL: the dashboard.env step is not in the stage"; exit 1; }

. "$LIB"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
env_file="$TOOL_ETC/dashboard.env"

# run_step [VALUE]: the step as the stage runs it, with DASHBOARD_FOUNDRY_URL set only when a value is given.
run_step() {
  (
    if [ "$#" -gt 0 ]; then export DASHBOARD_FOUNDRY_URL="$1"; else unset DASHBOARD_FOUNDRY_URL; fi
    gm_dir=/var/lib/foundry-ai-tool/obsidian/gm
    vault_name="Foundry GM vault"
    open_base=""
    ts_name=""
    LIB_CHANGED=""
    have_systemd() { return 1; }
    die() { echo "die: $*" >&2; exit 1; }
    eval "$snippet"
  ) 2>&1
}

rm -f "$env_file"

# 1.
out="$(run_step)"
if [ -f "$env_file" ] && ! grep -q '^DASHBOARD_FOUNDRY_URL=' "$env_file" && grep -q '^OBSIDIAN_VAULT_NAME="Foundry GM vault"$' "$env_file"; then
  pass "no value, no line"; else fail "no value: $(cat "$env_file" 2>&1)"; fi
if echo "$out" | grep -q 'initials'; then pass "the missing address is warned about"; else fail "no warning: $out"; fi

# 2.
run_step https://play.example.com >/dev/null
if grep -qx 'DASHBOARD_FOUNDRY_URL=https://play.example.com' "$env_file"; then pass "the address is written"; else fail "not written: $(cat "$env_file")"; fi
if [ "$(stat -c '%a %U:%G' "$env_file")" = "640 root:$FOUNDRY_USER" ]; then pass "mode 0640, root:$FOUNDRY_USER"; else fail "mode: $(stat -c '%a %U:%G' "$env_file")"; fi

# 3.
run_step >/dev/null
if grep -qx 'DASHBOARD_FOUNDRY_URL=https://play.example.com' "$env_file"; then pass "a rerun keeps the address"; else fail "lost on rerun: $(cat "$env_file")"; fi

# 4.
before="$(cat "$env_file")"
for bad in 'https://play.example.com/' 'https://play.example.com/foundry' 'play.example.com' 'https://play.example.com"x' 'https://u:p@play.example.com'; do
  if out="$(run_step "$bad")"; then fail "accepted '$bad'"; else
    if echo "$out" | grep -q 'plain address'; then pass "refused '$bad'"; else fail "wrong refusal for '$bad': $out"; fi
  fi
done
if [ "$(cat "$env_file")" = "$before" ]; then pass "a refused value leaves the file alone"; else fail "file changed after refusals"; fi

# 5.
run_step http://localhost:30100 >/dev/null
if grep -qx 'DASHBOARD_FOUNDRY_URL=http://localhost:30100' "$env_file" && [ "$(grep -c '^DASHBOARD_FOUNDRY_URL=' "$env_file")" -eq 1 ]; then
  pass "a new address replaces the old one"; else fail "replace: $(cat "$env_file")"; fi

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
