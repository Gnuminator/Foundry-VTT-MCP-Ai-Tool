#!/usr/bin/env bash
# Rebuild drill helper (docs/dev/PI-SETUP.md, "Rebuild drill"), runs inside the drill container.
# After the stages and the restore: start Foundry, the bridge and the dashboard from the unit
# files the stages wrote (run-unit.sh, because the container has no systemd), then check what a
# rebuilt Pi must show. Prints PASS or FAIL per check and exits 1 if any failed. Prints no secrets.
set -uo pipefail

fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad() {
  printf 'FAIL  %s\n' "$*"
  fail=1
}
check() {
  local what="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$what"; else bad "$what"; fi
}
tcp_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

echo "==> starting the services from their unit files"
rm -rf /var/lib/foundry/Config/options.json.lock
for unit in foundry foundry-ai-tool-bridge foundry-ai-tool-dashboard; do
  bash /drill-scripts/run-unit.sh "$unit"
  sleep 3
done
for _ in $(seq 1 60); do
  curl -fs -o /dev/null http://127.0.0.1:30000/api/status && break
  sleep 2
done
for _ in $(seq 1 30); do
  curl -fs -o /dev/null http://127.0.0.1:3000/ && break
  sleep 2
done

echo "==> checks"
status="$(curl -fs http://127.0.0.1:30000/api/status 2>/dev/null || true)"
echo "    /api/status: $status"
case "$status" in *'"active":true'*) pass "Foundry serves a running world" ;; *) bad "Foundry has no running world" ;; esac
grep -q 'license verification succeeded' /var/lib/foundry/Logs/*.log 2>/dev/null ||
  grep -q 'license verification succeeded' /drill/foundry.out 2>/dev/null &&
  pass "the restored Foundry licence verified (it is bound to the host name $(hostname))" ||
  bad "the Foundry licence did not verify (it is bound to the host name; this one is $(hostname))"
for w in /var/lib/foundry/Data/worlds/*/world.json; do
  [ -f "$w" ] && pass "world $(basename "$(dirname "$w")") is in /var/lib/foundry/Data/worlds"
done
check "dnd5e system is installed" test -f /var/lib/foundry/Data/systems/dnd5e/system.json
check "module foundry-mcp-bridge is installed" test -f /var/lib/foundry/Data/modules/foundry-mcp-bridge/module.json
check "the bridge listens on 31414 (control)" tcp_open 31414
check "the bridge listens on 31415 (Foundry link)" tcp_open 31415
check "the dashboard answers on 3000" curl -fs -o /dev/null http://127.0.0.1:3000/
check "/etc/foundry-ai-tool/assistant-gm.env is root only (0600)" test "$(stat -c %a /etc/foundry-ai-tool/assistant-gm.env 2>/dev/null)" = 600
check "the Discord bot is not running here (no systemd, never started)" bash -c '! pgrep -f "[d]iscord-bot/dist/cli.js"'
check "Syncthing has a device certificate" test -s /var/lib/foundry-ai-tool/syncthing/cert.pem
# restore.sh noted the restored device certificate's hash. Drill default: the real Pi's identity must
# NOT be in this container (stage 7 made a new one). DRILL_KEEP_SYNCTHING=1 (not run yet): it must be.
if [ -f /drill/syncthing-old.sha256 ]; then
  now="$(sha256sum /var/lib/foundry-ai-tool/syncthing/cert.pem 2>/dev/null | cut -d' ' -f1)"
  if [ "$(cat /drill/syncthing-expect 2>/dev/null)" = same ]; then
    if [ "$now" = "$(cat /drill/syncthing-old.sha256)" ]; then pass "Syncthing keeps the restored device identity"; else bad "Syncthing lost the restored device identity"; fi
  else
    if [ -n "$now" ] && [ "$now" != "$(cat /drill/syncthing-old.sha256)" ]; then pass "Syncthing here is NOT the real Pi's device (a new identity)"; else bad "Syncthing here has the real Pi's device identity"; fi
  fi
else
  echo "    (no restored Syncthing certificate noted: identity check skipped)"
fi
check "Foundry data is owned by foundry" test "$(stat -c %U /var/lib/foundry/Data)" = foundry

echo "==> the unit files (systemd-analyze verify)"
if ! command -v systemd-analyze >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd >/dev/null 2>&1 || true
fi
if command -v systemd-analyze >/dev/null 2>&1; then
  for u in /etc/systemd/system/foundry*.service /etc/systemd/system/foundry-backup.timer; do
    out="$(systemd-analyze verify "$u" 2>&1 || true)"
    if [ -z "$out" ]; then pass "$(basename "$u") verifies"; else
      bad "$(basename "$u"): $out"
    fi
  done
else
  echo "    (systemd-analyze could not be installed; unit files not verified)"
fi

echo "==> not proven here: the Assistant GM browser (Chromium crashes under qemu emulation), so no bridge-to-world round trip"
if [ "$fail" = 0 ]; then echo "### checks: all passed"; else echo "### checks: SOME FAILED"; fi
exit "$fail"
