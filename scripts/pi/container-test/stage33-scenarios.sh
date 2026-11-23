#!/usr/bin/env bash
# Pi stage 33 (scripts/pi/remote/33-obsidian-plugin.sh, backlog obsidian-plugin-via-vault) in a Debian 13 ARM64 container with
# the real Syncthing and the real lib.sh. Two Syncthing instances run on loopback with discovery, relays and NAT off: "Pi"
# (user foundry, the layout of stage 7, with the OLD .stignore that has no "!" lines) and "pc" (the GM's PC, whose own .stignore
# has the new lines). A fake release build stands in for the stage 5 build (PLUGIN_SRC).
# Scenarios:
#   1 CHECK=1 on a vault with no plugin: exit 1, changes nothing (no plugin folder, .stignore as it was)
#   2 the run writes the three files (mode 0640, owner foundry), puts the "!" lines above ".obsidian/plugins" and leaves the rest
#   3 the PC receives exactly main.js, manifest.json and styles.css; not a Pi-side data.json, not any other plugin file
#   4 a data.json on the PC never reaches the Pi, and a data.json on the Pi is left alone (warning, not deleted)
#   5 CHECK=1 now exits 0; a second run changes nothing (same hashes, no new "wrote" lines)
#   6 a new release build: the run rewrites only the changed file, the PC gets it, data.json stays
#   7 the refusals: a build without a file, a manifest of another plugin, a missing GM vault, a bad CHECK value
#   8 a .stignore without the .obsidian/plugins line is refused, and CHECK says not in step
#   9 a link where the stage would write is refused, and its target is not touched
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage33-scenarios.sh
# (scripts/pi/obsidian-plugin-stage.test.mjs runs it with PI_STAGE33_CONTAINER=1.) STAGE=<file> runs it against another copy.
#
# DESTRUCTIVE: it adds a user, installs packages and writes /var/lib/foundry-ai-tool. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }
require_test_container

STAGE="${STAGE:-/repo/scripts/pi/remote/33-obsidian-plugin.sh}"
LIB=/repo/scripts/pi/remote/lib.sh

. "$LIB"
set +e # lib.sh turns -e on; the scenarios count their own failures
mkdir -p /opt/node24/bin
ln -sf "$(command -v node)" /opt/node24/bin/node
useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
gm_dir="$TOOL_DATA/obsidian/gm"
pi_home="$TOOL_DATA/syncthing"
plugin_dir="$gm_dir/.obsidian/plugins/foundry-ai-tool"
pc_vault=/tmp/pc-vault
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA" "$TOOL_DATA/obsidian" "$gm_dir"
install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$pi_home"
mkdir -p /tmp/pc-st "$pc_vault" /tmp/build1 /tmp/build2

pi() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$pi_home" "$@"; }
pc() { HOME=/root syncthing cli --home=/tmp/pc-st "$@"; }
wait_for() {
  local n="$1" i=0
  shift
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le "$n" ] || return 1
    sleep 1
  done
}
quiet_options() {
  local cli="$1"
  "$cli" config options natenabled set false
  "$cli" config options local-ann-enabled set false
  "$cli" config options global-ann-enabled set false
  "$cli" config options relays-enabled set false
  "$cli" config options uraccepted set -- -1
}

runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing generate --home="$pi_home" >/dev/null 2>&1
HOME=/root syncthing generate --home=/tmp/pc-st >/dev/null 2>&1
sed -i 's/127\.0\.0\.1:8384/127.0.0.1:8385/; s#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22001</listenAddress>#' /tmp/pc-st/config.xml
sed -i 's#<listenAddress>default</listenAddress>#<listenAddress>tcp://127.0.0.1:22000</listenAddress>#' "$pi_home/config.xml"
runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" nohup syncthing serve --no-browser --no-restart --no-default-folder \
  --skip-port-probing --no-upgrade --home="$pi_home" --gui-address=127.0.0.1:8384 >/tmp/pi-st.log 2>&1 </dev/null &
wait_for 60 pi show system || { echo "SETUP FAILED: the Pi's Syncthing: $(cat /tmp/pi-st.log)"; exit 99; }
HOME=/root nohup syncthing serve --no-browser --no-restart --no-default-folder --skip-port-probing --no-upgrade \
  --home=/tmp/pc-st --gui-address=127.0.0.1:8385 >/tmp/pc-st.log 2>&1 </dev/null &
wait_for 60 pc show system || { echo "SETUP FAILED: the PC's Syncthing: $(cat /tmp/pc-st.log)"; exit 99; }
quiet_options pi
quiet_options pc
pi_id="$(pi show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
pc_id="$(pc show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
pi config devices add --device-id "$pc_id" --name gm-pc
pi config devices "$pc_id" addresses add tcp://127.0.0.1:22001
pc config devices add --device-id "$pi_id" --name test-pi
pc config devices "$pi_id" addresses add tcp://127.0.0.1:22000
pi config folders add --id foundry-gm-vault --label "Foundry GM vault" --path "$gm_dir" --type sendreceive
pc config folders add --id foundry-gm-vault --label "Foundry GM vault" --path "$pc_vault" --type sendreceive
pi config folders foundry-gm-vault devices add --device-id "$pc_id"
pc config folders foundry-gm-vault devices add --device-id "$pi_id"

# The Pi's .stignore as stage 7 wrote it before this stage; the PC's as the new guide and setup-syncthing-pc.ps1 write it.
old_stignore='// Per-device Obsidian state: each PC keeps its own (written by 7-vault.sh and setup-syncthing-pc.ps1).
.obsidian/workspace*.json
.obsidian/cache
.obsidian/plugins
.obsidian/community-plugins.json
.trash'
printf '%s\n' "$old_stignore" | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/.stignore" >/dev/null
cat >"$pc_vault/.stignore" <<'EOF'
// Per-device Obsidian state
.obsidian/workspace*.json
.obsidian/cache
!.obsidian/plugins/foundry-ai-tool/main.js
!.obsidian/plugins/foundry-ai-tool/manifest.json
!.obsidian/plugins/foundry-ai-tool/styles.css
.obsidian/plugins
.obsidian/community-plugins.json
.trash
EOF

make_build() { # $1 dir, $2 version, $3 main.js text
  printf '{"id":"foundry-ai-tool","name":"Foundry AI Tool","version":"%s"}\n' "$2" >"$1/manifest.json"
  printf '%s\n' "$3" >"$1/main.js"
  printf '.x { color: red; }\n' >"$1/styles.css"
}
make_build /tmp/build1 1.0.0 'console.log("v1");'
make_build /tmp/build2 1.1.0 'console.log("v2");'
cp /tmp/build1/main.js /tmp/build1-main.js

run_stage() { # env assignments first, as arguments
  (
    for kv in "$@"; do export "${kv?}"; done
    cat "$LIB" "$STAGE" | bash -s 2>&1
  )
}
sum() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
state() { find "$gm_dir" -type f -not -path '*/.stfolder/*' | sort | xargs -r sha256sum; }

# A first note so the folders are paired before the plugin exists.
printf 'note one\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/one.md" >/dev/null
wait_for 90 test -f "$pc_vault/one.md" || fail "setup: the PC did not get the first note"

# 1.
before="$(state)"
out="$(run_stage CHECK=1 PLUGIN_SRC=/tmp/build1)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'missing in the vault'; then pass "CHECK=1 on an empty vault exits 1"; else fail "check (exit $rc): $out"; fi
if [ ! -e "$plugin_dir" ] && [ "$before" = "$(state)" ]; then pass "CHECK=1 changed nothing"; else fail "CHECK=1 changed the vault"; fi

# 2.
out="$(run_stage PLUGIN_SRC=/tmp/build1)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'stage 33 done'; then pass "the run succeeds"; else fail "run (exit $rc): $out"; fi
ok=1
for f in main.js manifest.json styles.css; do
  [ "$(sum "$plugin_dir/$f")" = "$(sum /tmp/build1/$f)" ] || ok=0
  [ "$(stat -c '%a %U' "$plugin_dir/$f")" = "640 $FOUNDRY_USER" ] || ok=0
done
[ "$ok" = 1 ] && pass "the three files are the build's, mode 0640, owned by $FOUNDRY_USER" || fail "files wrong: $(ls -l "$plugin_dir")"
lines="$(cat "$gm_dir/.stignore")"
inc_line="$(printf '%s\n' "$lines" | grep -n '^!.obsidian/plugins/foundry-ai-tool/main.js$' | cut -d: -f1)"
ign_line="$(printf '%s\n' "$lines" | grep -n '^.obsidian/plugins$' | cut -d: -f1)"
if [ -n "$inc_line" ] && [ -n "$ign_line" ] && [ "$inc_line" -lt "$ign_line" ] && printf '%s\n' "$lines" | grep -q '^.trash$' &&
  printf '%s\n' "$lines" | grep -q '^// Per-device'; then
  pass "the include lines sit above .obsidian/plugins and the rest of .stignore is kept"
else
  fail ".stignore wrong: $lines"
fi
[ "$(printf '%s\n' "$lines" | grep -c '^!')" -eq 3 ] && pass "exactly three include lines" || fail "include line count: $lines"

# 3.
if wait_for 120 test -f "$pc_vault/.obsidian/plugins/foundry-ai-tool/styles.css"; then pass "the PC received the plugin files"; else fail "the PC got no plugin files"; fi
wait_for 30 test -f "$pc_vault/.obsidian/plugins/foundry-ai-tool/main.js"
pc_ok=1
for f in main.js manifest.json styles.css; do [ "$(sum "$pc_vault/.obsidian/plugins/foundry-ai-tool/$f")" = "$(sum /tmp/build1/$f)" ] || pc_ok=0; done
[ "$pc_ok" = 1 ] && pass "the PC's three files match the build" || fail "the PC's files differ"

# 4.
printf '{"token":"SECRET-PC"}\n' >"$pc_vault/.obsidian/plugins/foundry-ai-tool/data.json"
printf '{"token":"SECRET-PI"}\n' | runuser -u "$FOUNDRY_USER" -- tee "$plugin_dir/data.json" >/dev/null
printf 'other\n' >"$pc_vault/.obsidian/plugins/foundry-ai-tool/extra.txt"
printf 'note two\n' | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/two.md" >/dev/null
wait_for 90 test -f "$pc_vault/two.md" || fail "the sync stopped (note two did not arrive)"
# A positive control for the PC to Pi direction: a normal note made at the same moment as data.json and extra.txt. Once it has
# arrived on the Pi, the PC has scanned and sent, so an ignored file still missing means the ignore list worked.
printf 'from the pc\n' >"$pc_vault/pc-note.md"
wait_for 120 test -f "$gm_dir/pc-note.md" || fail "the PC's control note never reached the Pi, so scenario 4 proves nothing"
sleep 2
if [ ! -e "$plugin_dir/extra.txt" ] && [ "$(cat "$plugin_dir/data.json")" = '{"token":"SECRET-PI"}' ]; then
  pass "a PC-side data.json and extra file never reach the Pi, the Pi's data.json is untouched"
else
  fail "the Pi's plugin folder changed: $(ls -la "$plugin_dir")"
fi
if [ "$(cat "$pc_vault/.obsidian/plugins/foundry-ai-tool/data.json")" = '{"token":"SECRET-PC"}' ]; then pass "the Pi's data.json never reaches the PC"; else fail "the PC's data.json changed"; fi
out="$(run_stage PLUGIN_SRC=/tmp/build1)"
echo "$out" | grep -q 'data.json exists on the Pi' && pass "the run warns about the Pi's data.json" || fail "no data.json warning: $out"
echo "$out" | grep -q 'SECRET' && fail "the run printed a token" || pass "no token in the output"

# 5.
out="$(run_stage CHECK=1 PLUGIN_SRC=/tmp/build1)"
rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'the vault holds plugin 1.0.0'; then pass "CHECK=1 exits 0 when in step"; else fail "check 2 (exit $rc): $out"; fi
before="$(state)"
out="$(run_stage PLUGIN_SRC=/tmp/build1)"
rc=$?
if [ "$rc" -eq 0 ] && ! echo "$out" | grep -q 'ok: wrote' && [ "$before" = "$(state)" ]; then pass "a second run changes nothing"; else fail "rerun (exit $rc): $out"; fi

# 6.
out="$(run_stage PLUGIN_SRC=/tmp/build2)"
rc=$?
wrote="$(echo "$out" | grep -c 'ok: wrote')"
if [ "$rc" -eq 0 ] && [ "$wrote" -eq 2 ]; then pass "a new build rewrites main.js and manifest.json only"; else fail "new build (exit $rc, wrote $wrote): $out"; fi
pc_has_v2() { [ "$(sum "$pc_vault/.obsidian/plugins/foundry-ai-tool/main.js")" = "$(sum /tmp/build2/main.js)" ]; }
if wait_for 90 pc_has_v2; then pass "the PC gets the new main.js"; else fail "the PC kept the old main.js"; fi
[ "$(cat "$plugin_dir/data.json")" = '{"token":"SECRET-PI"}' ] && pass "data.json stayed through the update" || fail "data.json changed"
ls -A "$plugin_dir" | grep -q 'foundry-tmp' && fail "a temp file is left: $(ls -A "$plugin_dir")" || pass "no temp file is left behind"

# 7.
mkdir -p /tmp/build3
cp /tmp/build1/main.js /tmp/build1/manifest.json /tmp/build3/
out="$(run_stage CHECK=1 PLUGIN_SRC=/tmp/build3)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'the build has no'; then pass "a build without styles.css is refused"; else fail "no styles (exit $rc): $out"; fi
mkdir -p /tmp/build4
make_build /tmp/build4 1.0.0 'x'
printf '{"id":"another-plugin","version":"1"}\n' >/tmp/build4/manifest.json
out="$(run_stage PLUGIN_SRC=/tmp/build4)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'is not the Foundry AI Tool plugin'; then pass "a manifest of another plugin is refused"; else fail "other manifest (exit $rc): $out"; fi
out="$(run_stage CHECK=2 PLUGIN_SRC=/tmp/build1)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'CHECK is 0 or 1'; then pass "a bad CHECK value is refused"; else fail "bad CHECK (exit $rc): $out"; fi
mv "$TOOL_DATA/obsidian/gm" "$TOOL_DATA/obsidian/gm.away"
out="$(run_stage PLUGIN_SRC=/tmp/build1)"
rc=$?
mv "$TOOL_DATA/obsidian/gm.away" "$TOOL_DATA/obsidian/gm"
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'the GM vault .* is missing'; then pass "a missing GM vault is refused"; else fail "no vault (exit $rc): $out"; fi

# 8. A .stignore without the .obsidian/plugins line is refused (the plugins folder would sync whole), CHECK says not in step.
cp "$gm_dir/.stignore" /tmp/stignore.keep
grep -vx '\.obsidian/plugins' /tmp/stignore.keep | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/.stignore" >/dev/null
before="$(state)"
out="$(run_stage CHECK=1 PLUGIN_SRC=/tmp/build2)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'has no .obsidian/plugins line'; then pass "CHECK=1 flags a .stignore without the plugins line"; else fail "check no line (exit $rc): $out"; fi
out="$(run_stage PLUGIN_SRC=/tmp/build1)"
rc=$?
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'has no .obsidian/plugins line: refused' && [ "$before" = "$(state)" ]; then
  pass "a .stignore without the plugins line is refused and nothing is written"
else
  fail "no plugins line (exit $rc): $out"
fi
cat /tmp/stignore.keep | runuser -u "$FOUNDRY_USER" -- tee "$gm_dir/.stignore" >/dev/null

# 9. A link where the stage would write is refused, and its target is not touched.
rm -f /tmp/link-target
printf 'untouched\n' >/tmp/link-target
chmod 0666 /tmp/link-target
runuser -u "$FOUNDRY_USER" -- ln -s /tmp/link-target "$plugin_dir/styles.css.foundry-tmp"
printf '.y { color: blue; }\n' >/tmp/build2/styles.css
out="$(run_stage PLUGIN_SRC=/tmp/build2)"
rc=$?
runuser -u "$FOUNDRY_USER" -- rm -f "$plugin_dir/styles.css.foundry-tmp"
if [ "$rc" -eq 0 ] && [ "$(cat /tmp/link-target)" = untouched ] && [ "$(sum "$plugin_dir/styles.css")" = "$(sum /tmp/build2/styles.css)" ]; then
  pass "a link at the temp name is replaced, its target untouched"
else
  fail "temp link (exit $rc, target: $(cat /tmp/link-target)): $out"
fi
mv "$plugin_dir" "$plugin_dir.real"
runuser -u "$FOUNDRY_USER" -- ln -s /tmp "$plugin_dir"
out="$(run_stage PLUGIN_SRC=/tmp/build1)"
rc=$?
runuser -u "$FOUNDRY_USER" -- rm -f "$plugin_dir"
mv "$plugin_dir.real" "$plugin_dir"
if [ "$rc" -eq 1 ] && echo "$out" | grep -q 'is a link: refused' && [ ! -e /tmp/main.js ]; then pass "a linked plugin folder is refused"; else fail "linked folder (exit $rc): $out"; fi

[ "$fails" -eq 0 ] && echo "ALL SCENARIOS OK" || exit 1
