#!/usr/bin/env bash
# Stage 24 (scripts/pi/remote/24-modules.sh) in a Debian 13 ARM64 container with no systemd: stand-ins for systemctl,
# curl (/api/status and /join), journalctl and sleep make it take its systemd path. The zips are made by make-zip.mjs
# and pinned in a pinned.json the way `rehearse.mjs archive` writes it. Each scenario prints PASS or FAIL lines:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage24-scenarios.sh [name ...]
# DESTRUCTIVE: it wipes the Foundry data folder, the import folder and the module mirror and installs the fakes into
# /usr/local/sbin. It refuses to run anywhere but a container.
set -uo pipefail

[ -f /.dockerenv ] || [ -n "${container:-}" ] || {
  echo "REFUSED: run this only in the test container (docker run ..., see the header)"
  exit 98
}

H=/repo/scripts/pi/container-test
R=/repo/scripts/pi/remote
only=" $* "
export DEBIAN_FRONTEND=noninteractive
apt_setup() { apt-get update && apt-get install -y --no-install-recommends nodejs curl ca-certificates unzip; }
{ apt_setup || { /bin/sleep 20 && apt_setup; }; } >/dev/null 2>&1 || {
  echo "SETUP FAILED: apt-get"
  exit 99
}
mkdir -p /opt/node24/bin /run/systemd/system
ln -sf "$(command -v node)" /opt/node24/bin/node
for f in systemctl curl journalctl sleep logger; do install -m 755 "$H/bin/$f" "/usr/local/sbin/$f"; done
eval "$(grep -E '^(FOUNDRY_USER|FOUNDRY_APP|FOUNDRY_DATA|TOOL_DIR|TOOL_ETC|TOOL_DATA)=' "$R/lib.sh")"
id "$FOUNDRY_USER" >/dev/null 2>&1 || useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"
MODS="$FOUNDRY_DATA/Data/modules"
IMPORT=/var/lib/foundry-import
MIRROR=/home/dietpi/module-archive
SRC=/tmp/zipsrc

fail=0
check() { # $1 name, $2 what is expected in the output (grep -E), $3 the output
  if grep -Eq -- "$2" <<<"$3"; then echo "PASS $1: $2"; else
    echo "FAIL $1: wanted /$2/"
    echo "$3" | sed 's/^/    /'
    fail=1
  fi
}
absent() { # $1 name, $2 what must not be in the output, $3 the output
  if grep -Eq -- "$2" <<<"$3"; then
    echo "FAIL $1: did not want /$2/"
    echo "$3" | sed 's/^/    /'
    fail=1
  else echo "PASS $1: no /$2/"; fi
}
same() { # $1 name, $2 what, $3 the value before, $4 the value after
  if [ "$3" = "$4" ]; then echo "PASS $1: $2 unchanged"; else
    echo "FAIL $1: $2 changed"
    fail=1
  fi
}

fresh_pi() {
  rm -rf "${FOUNDRY_DATA:?}" "${FOUNDRY_APP:?}" "${TOOL_DIR:?}" "${TOOL_ETC:?}" "${TOOL_DATA:?}" "${IMPORT:?}" "${MIRROR:?}" "${SRC:?}"
  rm -f /tmp/stopped-* /tmp/calls /tmp/status /tmp/status_rc /tmp/joinfail /tmp/gm-counts /tmp/pins
  mkdir -p "$MODS" "$FOUNDRY_APP" "$TOOL_DIR/gm-browser" "$TOOL_ETC" "$TOOL_DATA" "$MIRROR/modules" "$SRC"
  chown -R "$FOUNDRY_USER" "$FOUNDRY_DATA"
  echo '{"version":"14.368.0"}' >"$FOUNDRY_APP/package.json"
  echo '// stand-in' >"$TOOL_DIR/gm-browser/assistant-gm.mjs"
  printf '{"active":true,"world":"curse-of-strahd","users":0}' >/tmp/status
  echo 0 >/tmp/status_rc
  : >/tmp/calls
  : >/tmp/pins
}

# install_old ID VERSION: a module folder as an earlier run left it (a marker file says which build it is).
install_old() {
  mkdir -p "$MODS/$1"
  printf '{"id":"%s","version":"%s"}' "$1" "$2" >"$MODS/$1/module.json"
  echo "old $2" >"$MODS/$1/marker.txt"
  chown -R "$FOUNDRY_USER" "$MODS/$1"
}

# pin ID VERSION [ENTRY...]: makes the zip in the mirror (default: module.json at the root plus a marker) and adds the pin.
pin() {
  local id="$1" version="$2" dir zip
  shift 2
  dir="$MIRROR/modules/$id/$version"
  zip="$dir/$id-$version.zip"
  mkdir -p "$dir"
  if [ "$#" -eq 0 ]; then
    set -- "module.json={\"id\":\"$id\",\"version\":\"$version\"}" "marker.txt=new $version"
  fi
  node "$H/make-zip.mjs" "$zip" "$@"
  echo "$id $version $(sha256sum "$zip" | cut -d' ' -f1)" >>/tmp/pins
}

# write_pins: pinned.json from /tmp/pins, the way rehearse.mjs archive writes the modules part.
write_pins() {
  node -e '
const fs = require("fs");
const modules = {};
for (const l of fs.readFileSync("/tmp/pins", "utf8").split("\n").filter(Boolean)) {
  const [id, version, sha256] = l.split(" ");
  modules[id] = { version, file: `modules/${id}/${version}/${id}-${version}.zip`, sha256 };
}
fs.writeFileSync(process.argv[1] + "/pinned.json", JSON.stringify({ updated: "", foundry: null, systems: {}, modules }, null, 2));
' "$MIRROR"
}

tree_hash() { (cd "$MODS" && find . -type f -exec sha256sum {} + | sort | sha256sum | cut -d' ' -f1); }
marker() { cat "$MODS/$1/marker.txt" 2>/dev/null || echo "(none)"; }

# $1 the environment words (a single string), prints the output and "exit N"
run_stage() {
  local out rc
  out="$(cd /root && cat "$R/lib.sh" "$R/24-modules.sh" | env NO_SNAPSHOT=1 $1 bash -s 2>&1)"
  rc=$?
  printf '%s\nexit %s\n' "$out" "$rc"
}
want() { [ -z "${only// /}" ] || [[ "$only" == *" $1 "* ]]; }

# two modules to update (one nested in a folder, as zipFolder and GitHub zips do), one new, one already current
base_setup() {
  fresh_pi
  install_old alpha 1.0.0
  install_old beta 2.0.0
  install_old current 3.0.0
  pin alpha 1.1.0
  pin beta 2.1.0 'beta-2.1.0/module.json={"id":"beta","version":"2.1.0"}' 'beta-2.1.0/marker.txt=new 2.1.0'
  pin gamma 0.5.0
  pin current 3.0.0
  write_pins
}

if want dry-run; then
  base_setup
  before="$(tree_hash)"
  out="$(run_stage '')"
  check dry-run 'alpha: 1.0.0 -> 1.1.0' "$out"
  check dry-run 'beta: 2.0.0 -> 2.1.0' "$out"
  check dry-run 'gamma: not installed -> 0.5.0' "$out"
  check dry-run 'current 3.0.0: already installed' "$out"
  check dry-run 'dry run: nothing was changed' "$out"
  check dry-run 'exit 0' "$out"
  same dry-run 'the module folders' "$before" "$(tree_hash)"
  absent dry-run 'stop foundry' "$(cat /tmp/calls)"
  [ ! -e "$IMPORT/modules-stage.state" ] && echo "PASS dry-run: no state file" || { echo "FAIL dry-run: state file written"; fail=1; }
  [ -z "$(ls -d "$IMPORT"/work-* 2>/dev/null)" ] && echo "PASS dry-run: work folder removed" || { echo "FAIL dry-run: work folder left"; fail=1; }
fi

if want apply; then
  base_setup
  out="$(run_stage 'APPLY=1')"
  check apply 'alpha: 1.0.0 -> 1.1.0' "$out"
  check apply 'Foundry is up' "$out"
  check apply 'the Assistant GM browser joined the world' "$out"
  check apply 'alpha 1.1.0' "$out"
  check apply 'gamma 0.5.0' "$out"
  check apply 'done: 3 module\(s\) installed' "$out"
  check apply 'exit 0' "$out"
  check apply 'new 1.1.0' "$(marker alpha)"
  check apply 'new 2.1.0' "$(marker beta)"
  check apply 'new 0.5.0' "$(marker gamma)"
  check apply 'old 3.0.0' "$(marker current)"
  prev="$(ls -d "$IMPORT"/prev-*-modules)"
  check apply 'old 1.0.0' "$(cat "$prev/alpha/marker.txt")"
  [ ! -e "$prev/gamma" ] && echo "PASS apply: gamma had no old folder" || { echo "FAIL apply: gamma in prev"; fail=1; }
  check apply 'phase=installed' "$(cat "$IMPORT/modules-stage.state")"
  check apply "^$FOUNDRY_USER\$" "$(stat -c %U "$MODS/alpha/module.json")"
  check apply 'stop foundry.service' "$(cat /tmp/calls)"
  check apply 'restart foundry.service' "$(cat /tmp/calls)"
  # a rerun finds everything at its pinned version and changes nothing
  after="$(tree_hash)"
  out="$(run_stage 'APPLY=1')"
  check apply-rerun '0 module\(s\) to change, 4 already' "$out"
  check apply-rerun 'nothing to do' "$out"
  same apply-rerun 'the module folders' "$after" "$(tree_hash)"
fi

if want undo; then
  base_setup
  out="$(run_stage 'APPLY=1')"
  check undo-setup 'exit 0' "$out"
  out="$(run_stage 'UNDO=1')"
  check undo 'alpha: 1.0.0 is back' "$out"
  check undo 'gamma: was not installed before' "$out"
  check undo 'the old module folders are back' "$out"
  check undo 'exit 0' "$out"
  check undo 'old 1.0.0' "$(marker alpha)"
  check undo 'old 2.0.0' "$(marker beta)"
  [ ! -e "$MODS/gamma" ] && echo "PASS undo: gamma moved aside" || { echo "FAIL undo: gamma still installed"; fail=1; }
  [ -d "$(ls -d "$IMPORT"/failed-*-modules)/gamma" ] && echo "PASS undo: gamma kept in failed-*" || { echo "FAIL undo: gamma not kept"; fail=1; }
  check undo 'phase=undone' "$(cat "$IMPORT/modules-stage.state")"
  out="$(run_stage 'UNDO=1')"
  check undo-twice 'already undone' "$out"
  check undo-twice 'exit 1' "$out"
fi

if want undo-without-run; then
  fresh_pi
  out="$(run_stage 'UNDO=1')"
  check undo-without-run 'there is no run to undo' "$out"
  check undo-without-run 'exit 1' "$out"
fi

if want join-fails; then
  base_setup
  before="$(tree_hash)"
  touch /tmp/joinfail
  out="$(run_stage 'APPLY=1')"
  check join-fails "Foundry's world did not come back" "$out"
  check join-fails 'the run did not finish' "$out"
  check join-fails 'alpha: 1.0.0 is back' "$out"
  check join-fails 'exit 1' "$out"
  same join-fails 'the module folders (old ones restored)' "$before" "$(tree_hash)"
  check join-fails 'phase=undone' "$(cat "$IMPORT/modules-stage.state")"
  # the trap started Foundry again as it was before the run
  check join-fails 'restart foundry.service' "$(tail -n 8 /tmp/calls)"
fi

if want bad-sha; then
  base_setup
  printf 'tampered' >>"$MIRROR/modules/alpha/1.1.0/alpha-1.1.0.zip"
  before="$(tree_hash)"
  out="$(run_stage 'APPLY=1')"
  check bad-sha "alpha: the zip's sha256 is" "$out"
  check bad-sha 'Nothing was changed' "$out"
  check bad-sha 'exit 1' "$out"
  same bad-sha 'the module folders' "$before" "$(tree_hash)"
  absent bad-sha 'stop foundry' "$(cat /tmp/calls)"
fi

if want bad-entry; then
  base_setup
  pin delta 1.0.0 'module.json={"id":"delta","version":"1.0.0"}' '../escape.txt=x'
  write_pins
  out="$(run_stage 'APPLY=1')"
  check bad-entry 'delta: the zip has an entry outside its folder' "$out"
  check bad-entry 'exit 1' "$out"
  [ ! -e "$MODS/../escape.txt" ] && echo "PASS bad-entry: nothing written outside" || { echo "FAIL bad-entry: escape.txt exists"; fail=1; }
  absent bad-entry 'stop foundry' "$(cat /tmp/calls)"
fi

if want link-in-zip; then
  base_setup
  pin delta 1.0.0 'module.json={"id":"delta","version":"1.0.0"}' 'L:evil=/etc/passwd'
  write_pins
  out="$(run_stage 'APPLY=1')"
  check link-in-zip 'delta: the zip holds a link' "$out"
  check link-in-zip 'exit 1' "$out"
  absent link-in-zip 'stop foundry' "$(cat /tmp/calls)"
fi

if want wrong-version; then
  base_setup
  pin delta 1.0.0 'module.json={"id":"delta","version":"9.9.9"}'
  write_pins
  out="$(run_stage 'APPLY=1')"
  check wrong-version "delta: the zip's module.json says version '9.9.9', the pin says 1.0.0" "$out"
  check wrong-version 'exit 1' "$out"
  absent wrong-version 'stop foundry' "$(cat /tmp/calls)"
fi

if want wrong-id; then
  base_setup
  pin delta 1.0.0 'module.json={"id":"other","version":"1.0.0"}'
  write_pins
  out="$(run_stage 'APPLY=1')"
  check wrong-id "delta: the zip holds module 'other'" "$out"
  check wrong-id 'exit 1' "$out"
fi

if want bad-pin; then
  base_setup
  node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
p.modules["../evil"] = { version: "1.0.0", file: "modules/../evil/1.0.0/x.zip", sha256: "0".repeat(64) };
fs.writeFileSync(process.argv[1], JSON.stringify(p));
' "$MIRROR/pinned.json"
  out="$(run_stage 'APPLY=1')"
  check bad-pin "'../evil' is not a safe module id" "$out"
  check bad-pin 'exit 1' "$out"
  absent bad-pin 'stop foundry' "$(cat /tmp/calls)"
  base_setup
  node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
p.modules.alpha.file = "../../etc/passwd";
fs.writeFileSync(process.argv[1], JSON.stringify(p));
' "$MIRROR/pinned.json"
  out="$(run_stage 'APPLY=1')"
  check bad-pin-file "alpha: the pin's file is" "$out"
  check bad-pin-file 'exit 1' "$out"
fi

if want skipped; then
  base_setup
  pin foundry-mcp-bridge 9.0.0
  pin aitool-content 1.0.0
  write_pins
  out="$(run_stage '')"
  check skipped 'foundry-mcp-bridge is pinned, but it is not installed by this stage' "$out"
  check skipped 'aitool-content is pinned, but it is not installed by this stage' "$out"
  check skipped 'exit 0' "$out"
fi

if want only; then
  base_setup
  out="$(run_stage 'APPLY=1 ONLY=alpha')"
  check only '1 module\(s\) to change' "$out"
  check only 'new 1.1.0' "$(marker alpha)"
  check only 'old 2.0.0' "$(marker beta)"
  out="$(run_stage 'ONLY=nosuch')"
  check only-unknown 'ONLY names nosuch' "$out"
  check only-unknown 'exit 1' "$out"
fi

if want players-online; then
  base_setup
  printf '{"active":true,"world":"curse-of-strahd","users":2}' >/tmp/status
  before="$(tree_hash)"
  out="$(run_stage 'APPLY=1')"
  check players-online '2 player\(s\) are online' "$out"
  check players-online 'exit 1' "$out"
  same players-online 'the module folders' "$before" "$(tree_hash)"
  absent players-online 'stop foundry' "$(cat /tmp/calls)"
  # the dry run does not care who is online
  out="$(run_stage '')"
  check players-online-dry 'dry run: nothing was changed' "$out"
fi

if want no-mirror; then
  fresh_pi
  rm -rf "${MIRROR:?}"
  out="$(run_stage '')"
  check no-mirror "no folder $MIRROR" "$out"
  check no-mirror 'exit 1' "$out"
  fresh_pi
  out="$(run_stage '')"
  check no-pinned-file "no $MIRROR/pinned.json" "$out"
  fresh_pi
  echo '{"modules":{}}' >"$MIRROR/pinned.json"
  out="$(run_stage '')"
  check no-pins 'pins no module' "$out"
fi

if want zip-missing; then
  base_setup
  rm "$MIRROR/modules/alpha/1.1.0/alpha-1.1.0.zip"
  out="$(run_stage 'APPLY=1')"
  check zip-missing 'alpha: no file' "$out"
  check zip-missing 'exit 1' "$out"
fi

if want kit-up; then
  base_setup
  echo up >"$TOOL_DATA/kit-session.env"
  out="$(run_stage 'APPLY=1')"
  check kit-up 'a kit session is up' "$out"
  check kit-up 'exit 1' "$out"
fi

if want bad-env; then
  base_setup
  out="$(run_stage 'APPLY=yes')"
  check bad-apply 'APPLY must be 1 or left out' "$out"
  out="$(run_stage 'APPLY=1 UNDO=1')"
  check both 'pick one' "$out"
  out="$(run_stage 'MIRROR=relative/path')"
  check bad-mirror 'MIRROR must be an absolute path' "$out"
fi

if want old-driver; then
  base_setup
  echo '{"version":"14.369.0"}' >"$FOUNDRY_APP/package.json"
  out="$(run_stage 'APPLY=1')"
  check old-driver 'only types the name' "$out"
  check old-driver 'exit 1' "$out"
  absent old-driver 'stop foundry' "$(cat /tmp/calls)"
  echo 'await name.selectOption({ label: user });' >"$TOOL_DIR/gm-browser/assistant-gm.mjs"
  out="$(run_stage '')"
  check new-driver 'dry run: nothing was changed' "$out"
fi

[ "$fail" = 0 ] && echo "ALL PASSED" || echo "FAIL: see above"
exit "$fail"
