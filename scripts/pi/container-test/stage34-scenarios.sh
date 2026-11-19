#!/usr/bin/env bash
# Pi stage 34 (scripts/pi/remote/34-map-upscale.sh, backlog map-upscale-pi) in a Debian 13 ARM64 container with the real
# lib.sh. Synthetic JPEG-looking files stand in for the maps (no book art is used). The GM part is checked up to the point
# where gm-script.sh would take over: the file it would run is built in /root and compared with its three pieces; systemd
# and the status port are faked (a stub curl, an empty /run/systemd/system).
# Scenarios:
#   1 MODE=check with nothing installed: exit 1, changes nothing; the refusals: a bad MODE, APPLY on check, a bad FOLDER
#   2 MODE=files without a manifest, with a manifest line that is not "<sha256>  <name>.jpg", with a staged file of the wrong hash:
#     each refuses and writes nothing under Data/assets
#   3 MODE=files installs the folder (owner foundry, mode 0644), originals under ddb-images untouched; check now exits 0
#   4 a second MODE=files changes nothing (all files already right); a damaged installed file is rewritten
#   5 a symlink at the destination or in the staged maps is refused
#   6 the GM modes: scale needs data.js; a data.js for another FOLDER is refused; switch refuses while the files are missing
#   7 the GM file is built as MAP_MODE line + data.js + the scenes script, a dry run by default, a real run only with APPLY=1
#     and then only with a fresh snapshot (NO_SNAPSHOT is not honoured off DietPi in the stub), nothing deleted anywhere
# The last line is ALL SCENARIOS OK when every one passed:
#   docker run --rm --platform linux/arm64 -v "<repo>:/repo:ro" <IMAGE> bash /repo/scripts/pi/container-test/stage34-scenarios.sh
# (scripts/pi/map-upscale-stage.test.mjs runs it with PI_STAGE34_CONTAINER=1.) STAGE=<file> runs it against another copy.
#
# DESTRUCTIVE: it adds a user and writes /var/lib/foundry and /root. It refuses to run anywhere but a container.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }
require_test_container

STAGE="${STAGE:-/repo/scripts/pi/remote/34-map-upscale.sh}"
SCENES_JS="${SCENES_JS:-/repo/scripts/pi/remote/map-upscale-scenes.js}"
LIB=/repo/scripts/pi/remote/lib.sh

. "$LIB"
set +e # lib.sh turns -e on; the scenarios count their own failures
mkdir -p /opt/node24/bin
ln -sf "$(command -v node)" /opt/node24/bin/node
useradd --system --no-create-home --shell /usr/sbin/nologin "$FOUNDRY_USER"
data="$FOUNDRY_DATA/Data"
install -d -m 0755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$FOUNDRY_DATA" "$data" "$data/assets" "$data/ddb-images" "$data/ddb-images/adv"
printf 'original map bytes\n' >"$data/ddb-images/adv/orig-a.jpg"
orig_sum="$(sha256sum "$data/ddb-images/adv/orig-a.jpg" | cut -d' ' -f1)"

src=/root/map-upscale
mkdir -p "$src/maps"
mkjpg() { { printf '\xff\xd8\xff\xe0'; head -c "$2" /dev/urandom; } >"$1"; }
mkjpg "$src/maps/map-a.jpg" 3000
mkjpg "$src/maps/map-b.jpg" 5000
write_manifest() {
  (cd "$src/maps" && sha256sum map-a.jpg map-b.jpg) >"$src/manifest.sha256"
}
write_manifest
printf 'const DATA = { "switch": { "ddb-images/adv/orig-a.jpg": "assets/strahd-maps-2x/map-a.jpg" }, "size": [], "grid": [] };\n' >"$src/data.js"
cp "$SCENES_JS" "$src/map-upscale-scenes.js"

# run MODE [VAR=value...]: runs lib.sh + the stage as the Pi's remote does (cat | bash -s); prints the output, returns its exit code.
run() {
  local mode="$1"
  shift
  cat "$LIB" "$STAGE" | env MODE="$mode" "$@" bash -s 2>&1
}
dest="$data/assets/strahd-maps-2x"
count_assets() { find "$data/assets" -mindepth 1 | wc -l; }

# 1 ---------------------------------------------------------------------------------------------------------------------
out="$(run check)"
rc=$?
[ "$rc" = 1 ] && pass "1 check with nothing installed exits 1" || fail "1 check exit $rc: $out"
[ "$(count_assets)" = 0 ] && pass "1 check changed nothing" || fail "1 check wrote something"
for bad in "MODE=nonsense" "MODE=check APPLY=1" "MODE=check FOLDER=assets/../x" "MODE=check FOLDER=other/x" "MODE=check APPLY=0"; do
  # shellcheck disable=SC2086
  out="$(cat "$LIB" "$STAGE" | env $bad bash -s 2>&1)"
  rc=$?
  { [ "$rc" != 0 ] && echo "$out" | grep -q "Nothing was changed"; } && pass "1 refuses $bad" || fail "1 $bad: rc $rc: $out"
done

# 2 ---------------------------------------------------------------------------------------------------------------------
mv "$src/manifest.sha256" "$src/manifest.keep"
out="$(run files)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "no $src/manifest.sha256"; } && pass "2 files without a manifest refused" || fail "2 no manifest: $rc $out"
mv "$src/manifest.keep" "$src/manifest.sha256"
cp "$src/manifest.sha256" "$src/manifest.good"
printf 'abc  ../../etc/passwd\n' >"$src/manifest.sha256"
out="$(run files)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "not '<sha256>  <name>.jpg'"; } && pass "2 odd manifest line refused" || fail "2 odd manifest: $rc $out"
cp "$src/manifest.good" "$src/manifest.sha256"
cp "$src/maps/map-b.jpg" "$src/maps/map-b.keep"
printf 'x' >>"$src/maps/map-b.jpg"
out="$(run files)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "do not match the manifest"; } && pass "2 wrong staged hash refused" || fail "2 wrong hash: $rc $out"
mv "$src/maps/map-b.keep" "$src/maps/map-b.jpg"
[ "$(count_assets)" = 0 ] && pass "2 the refusals wrote nothing" || fail "2 something was written"

# 3 ---------------------------------------------------------------------------------------------------------------------
out="$(run files)"
rc=$?
[ "$rc" = 0 ] && pass "3 files exits 0" || fail "3 files exit $rc: $out"
echo "$out" | grep -q "copied 2 file(s), 0 already right" && pass "3 copied both" || fail "3 summary: $out"
[ "$(stat -c '%U %a' "$dest/map-a.jpg")" = "$FOUNDRY_USER 644" ] && pass "3 owner and mode" || fail "3 owner/mode $(stat -c '%U %a' "$dest/map-a.jpg")"
[ "$(sha256sum "$data/ddb-images/adv/orig-a.jpg" | cut -d' ' -f1)" = "$orig_sum" ] && pass "3 originals untouched" || fail "3 original changed"
[ "$(find "$dest" -name '*.foundry-tmp' | wc -l)" = 0 ] && pass "3 no temp files left" || fail "3 temp files"
out="$(run check)"
rc=$?
[ "$rc" = 0 ] && pass "3 check now exits 0" || fail "3 check exit $rc: $out"

# 4 ---------------------------------------------------------------------------------------------------------------------
out="$(run files)"
echo "$out" | grep -q "copied 0 file(s), 2 already right" && pass "4 a second run changes nothing" || fail "4 second run: $out"
printf 'damaged' >"$dest/map-a.jpg"
out="$(run check)"
rc=$?
[ "$rc" = 1 ] && pass "4 check sees the damaged file" || fail "4 check exit $rc"
out="$(run files)"
echo "$out" | grep -q "copied 1 file(s), 1 already right" && pass "4 only the damaged file is rewritten" || fail "4 rewrite: $out"

# 5 ---------------------------------------------------------------------------------------------------------------------
mv "$dest" "$dest.real"
ln -s "$dest.real" "$dest"
out="$(run files)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "is a symlink"; } && pass "5 symlinked destination refused" || fail "5 dest link: $rc $out"
rm "$dest"
mv "$dest.real" "$dest"
mv "$src/maps/map-a.jpg" "$src/map-a.real"
ln -s "$src/map-a.real" "$src/maps/map-a.jpg"
out="$(run files)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "staged: map-a.jpg is missing"; } && pass "5 symlinked staged map refused" || fail "5 staged link: $rc $out"
rm "$src/maps/map-a.jpg"
mv "$src/map-a.real" "$src/maps/map-a.jpg"

# 6 ---------------------------------------------------------------------------------------------------------------------
out="$(run scale)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "needs systemd"; } && pass "6 GM modes need systemd (the container has none)" || fail "6 systemd: $rc $out"
mkdir -p /run/systemd/system
mv "$src/data.js" "$src/data.keep"
out="$(run scale)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "no $src/data.js"; } && pass "6 scale needs data.js" || fail "6 no data.js: $rc $out"
mv "$src/data.keep" "$src/data.js"
out="$(run scale FOLDER=assets/other-folder)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "no path under assets/other-folder/"; } && pass "6 data.js for another folder refused" || fail "6 folder: $rc $out"
mv "$dest" "$dest.away"
out="$(run switch)"
rc=$?
{ [ "$rc" != 0 ] && echo "$out" | grep -q "run MODE=files first"; } && pass "6 switch refuses while the 2x files are missing" || fail "6 switch no files: $rc $out"
mv "$dest.away" "$dest"

# 7 ---------------------------------------------------------------------------------------------------------------------
# Stubs: a status answer with the world and no users, and systemctl saying nothing runs.
mkdir -p /tmp/stub
cat >/tmp/stub/curl <<'EOF'
#!/bin/sh
echo '{"active":true,"world":"curse-of-strahd","users":0}'
EOF
cat >/tmp/stub/systemctl <<'EOF'
#!/bin/sh
exit 3
EOF
chmod +x /tmp/stub/curl /tmp/stub/systemctl
runstub() {
  local mode="$1"
  shift
  cat "$LIB" "$STAGE" | env PATH="/tmp/stub:$PATH" MODE="$mode" "$@" bash -s 2>&1
}
rm -f /root/map-upscale-run.js
out="$(runstub switch)"
echo "$out" | grep -q "dry run of the switch script" && pass "7 switch is a dry run without APPLY" || fail "7 dry run: $out"
expected="$(printf "const MAP_MODE = 'switch';\n"; cat "$src/data.js"; printf '\n'; cat "$src/map-upscale-scenes.js")"
[ "$(cat /root/map-upscale-run.js)" = "$expected" ] && pass "7 the GM file is the mode line, data.js and the script" || fail "7 GM file differs"
out="$(runstub scenes-check)"
echo "$out" | grep -q "MAP_MODE\|dry run of the check script" && grep -q "^const MAP_MODE = 'check';" /root/map-upscale-run.js && pass "7 scenes-check builds the check script, dry run" || fail "7 scenes-check: $out"
out="$(runstub scale APPLY=1)"
rc=$?
echo "$out" | grep -q "REAL run of the scale script" && pass "7 APPLY=1 is a real run (snapshot check skipped off DietPi)" || fail "7 apply: $rc $out"
out="$(runstub scale APPLY=1 | grep -c .)"
[ "$(sha256sum "$data/ddb-images/adv/orig-a.jpg" | cut -d' ' -f1)" = "$orig_sum" ] && pass "7 originals still untouched" || fail "7 original changed"

echo
if [ "$fails" = 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails SCENARIO(S) FAILED"; exit 1; fi
