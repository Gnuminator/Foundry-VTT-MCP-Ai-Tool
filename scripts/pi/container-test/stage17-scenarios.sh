#!/usr/bin/env bash
# Two steps of Pi stage 17 (scripts/pi/remote/17-gh-runner.sh) in a Debian 13 ARM64 container, with the real runuser, a
# real `ghrunner` user and the real apt: the libicu check (ensure_libicu) and the registration command are cut out of
# the script and run. The stand-in config.sh behaves like GitHub's: a relative `ldd ./bin/...` check that fails when the
# cwd is not its folder (live failure 1, 2026-10-28) and an `ldconfig -NXv | grep libicu` check that prints its reason
# on STDOUT and exits (live failure 2, same day: no libicu on the Pi, and the stage sent stdout to /dev/null).
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" debian:13-slim bash /repo/scripts/pi/container-test/stage17-scenarios.sh
# (scripts/pi/gh-runner.test.mjs runs it with PI_STAGE17_CONTAINER=1.) STAGE=<file> runs the scenarios against another copy
# of the script (the old one, to see them fail).
#
# DESTRUCTIVE: it adds a user, /opt/gh-runner and packages. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

STAGE="${STAGE:-/repo/scripts/pi/remote/17-gh-runner.sh}"
LIB=/repo/scripts/pi/remote/lib.sh
RUNNER_USER=ghrunner
dir=/opt/gh-runner/vault
reg=/tmp/vault.reg
TOKEN=ABCDEFGHIJKLMNOPQRSTUVWX
fails=0
pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }

export DEBIAN_FRONTEND=noninteractive
{ apt-get update && apt-get install -y --no-install-recommends ca-certificates; } >/dev/null 2>&1 || { echo "SETUP FAILED: apt-get"; exit 99; }
# A slim image has no ICU: the state of the Pi.
if ldconfig -p | grep -q 'libicuuc\.so'; then echo "SETUP FAILED: libicu is already in the image"; exit 99; fi

useradd --system --no-create-home --shell /usr/sbin/nologin "$RUNNER_USER"
install -d -m 0750 -o "$RUNNER_USER" -g "$RUNNER_USER" "$dir" "$dir/bin" "$dir/home" "$dir/_work"
touch "$dir/bin/libcoreclr.so"
chown "$RUNNER_USER" "$dir/bin/libcoreclr.so"
printf '%s\n' "$TOKEN" >"$reg"

cat >"$dir/config.sh" <<'EOF'
#!/usr/bin/env bash
# Like GitHub's config.sh: a relative path to its own bin folder, then the libicu check with its message on stdout.
[ -e ./bin/libcoreclr.so ] || { echo "ldd: ./bin/libcoreclr.so: No such file or directory" >&2; exit 1; }
if ! ldconfig -NXv 2>/dev/null | grep -q libicu; then
  echo "Libicu's dependencies is missing for Dotnet Core 6.0"
  echo "debug: token was $ACTIONS_RUNNER_INPUT_TOKEN"
  echo "$ACTIONS_RUNNER_INPUT_TOKEN"  echo "Execute ./bin/installdependencies.sh to install any missing Dotnet Core 6.0 dependencies."
  exit 1
fi
[ "${ACTIONS_RUNNER_INPUT_TOKEN:-}" = "ABCDEFGHIJKLMNOPQRSTUVWX" ] || exit 2
touch .runner
EOF
chmod 0755 "$dir/config.sh"
chown "$RUNNER_USER" "$dir/config.sh"

# The stage's own text: the registration step (from `if out=` to its `fi`) and the ensure_libicu function.
reg_snippet="$(sed -n '/^    if out="\$(/,/^    fi$/p' "$STAGE")"
[ -n "$reg_snippet" ] || reg_snippet="$(sed -n '/^    ACTIONS_RUNNER_INPUT_TOKEN=/,/die "registering runner/p' "$STAGE")" # the old script
[ -n "$reg_snippet" ] || { echo "FAIL: registration command not found in the stage"; exit 1; }
icu_snippet="$(sed -n '/^ensure_libicu() {/,/^}/p' "$STAGE")"

register_from() {
  rm -f "$dir/.runner"
  (
    cd "$1" || exit 1
    RUNNER_USER=$RUNNER_USER dir=$dir reg=$reg GH_OWNER=Gnuminator repo=obsidian-vault name=vault
    die() { echo "die: $*" >&2; exit 1; }
    eval "$reg_snippet"
  )
}

# 1. No libicu: the registration fails, and the reason (config.sh's stdout) is shown, with no token in it.
chmod 700 /root
register_from /root >/tmp/out1 2>&1
rc=$?
if [ "$rc" -ne 0 ] && [ ! -f "$dir/.runner" ]; then pass "registration fails without libicu"; else fail "registration did not fail without libicu"; fi
if grep -q "Libicu's dependencies is missing" /tmp/out1; then pass "config.sh's reason is shown"; else
  fail "the libicu message is not shown"
  cat /tmp/out1
fi
if grep -q "$TOKEN" /tmp/out1; then fail "the token reached the output"; else pass "the token is not in the output"; fi

# 2. ensure_libicu installs libicu when it is missing, and says so, even when the apt lists were never fetched (the Pi).
rm -rf /var/lib/apt/lists/*
if [ -z "$icu_snippet" ]; then fail "ensure_libicu is not in the stage"; else
  out2="$(
    . "$LIB"
    eval "$icu_snippet"
    ensure_libicu 2>&1
  )"
  echo "$out2" | sed 's/^/    /'
  if ldconfig -p | grep -q 'libicuuc\.so' && echo "$out2" | grep -q 'installed libicu'; then pass "libicu installed and reported"; else fail "libicu was not installed"; fi
  # 3. a second run installs nothing.
  out3="$(
    . "$LIB"
    eval "$icu_snippet"
    apt-get() { echo "APT CALLED" >&2; return 1; }
    ensure_libicu 2>&1
  )"
  if echo "$out3" | grep -q 'APT CALLED'; then fail "second run called apt"; else pass "second run installs nothing"; fi
fi

# 4. With libicu, the registration works from a folder the runner user cannot enter, from the runner folder and from /.
for d in /root "$dir" /; do
  if register_from "$d" >/tmp/out4 2>&1 && [ -f "$dir/.runner" ]; then pass "registers when started from $d"; else
    fail "register from $d"
    cat /tmp/out4
  fi
done

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
