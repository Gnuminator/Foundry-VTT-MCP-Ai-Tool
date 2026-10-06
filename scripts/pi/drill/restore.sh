#!/usr/bin/env bash
# Rebuild drill helper (docs/dev/PI-SETUP.md, "Rebuild drill"), runs inside the drill container.
# The restore step of a rebuild: take the newest snapshot of the PC's restic copy and put the three
# backed-up trees back (/var/lib/foundry, /var/lib/foundry-ai-tool, /etc/foundry-ai-tool) with the
# right owners. Run it after stage 3 (Foundry installed, stopped) and BEFORE stage 6, so the
# restored restic-pi.pass is the one stage 6 builds the new repository with (the PC's copy job
# keeps working with the password it already holds).
# Environment: PC_REPO (default /drill/pc-repo), PC_PASS (default /drill/restic-pc.pass),
# SNAPSHOT (default latest). The repository is only read (--no-lock).
set -euo pipefail

export RESTIC_REPOSITORY="${PC_REPO:-/drill/pc-repo}"
export RESTIC_PASSWORD_FILE="${PC_PASS:-/drill/restic-pc.pass}"
snapshot="${SNAPSHOT:-latest}"
stage_dir=/drill/restored
start=$(date +%s)

[ "$(id -u)" -eq 0 ] || {
  echo "run as root" >&2
  exit 1
}
id foundry >/dev/null 2>&1 || {
  echo "no foundry user: run stage 1 first" >&2
  exit 1
}
[ -f /opt/foundry/main.js ] || {
  echo "Foundry is not installed: run stage 3 first" >&2
  exit 1
}
if pgrep -f '[/]opt/foundry/main.js' >/dev/null 2>&1; then
  echo "Foundry is running: stop it before restoring" >&2
  exit 1
fi

if ! command -v restic >/dev/null 2>&1; then
  echo "==> installing restic"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends restic >/dev/null
fi
echo "==> $(restic version </dev/null)"

echo "==> snapshots in the PC copy"
restic snapshots --no-lock --compact </dev/null

echo "==> restoring $snapshot into $stage_dir (a staging folder, nothing live is touched yet)"
rm -rf "${stage_dir:?}"
mkdir -p "$stage_dir"
restic restore "$snapshot" --no-lock --target "$stage_dir" </dev/null | tail -n 3

for tree in var/lib/foundry var/lib/foundry-ai-tool etc/foundry-ai-tool; do
  [ -d "$stage_dir/$tree" ] || {
    echo "the snapshot has no /$tree" >&2
    exit 1
  }
done

# DRILL ONLY: leave out Syncthing's folder. It holds the real Pi's device key; a second Syncthing
# with that key (this container, dialling out to the global discovery servers and relays) would
# meet the real peers and could sync the vault from an old copy. A real rebuild keeps it, so every
# PC still trusts the Pi: see "Rebuild drill" in docs/dev/PI-SETUP.md. Stage 7 below makes a new one.
if [ "${DRILL_KEEP_SYNCTHING:-0}" != 1 ]; then
  rm -rf "${stage_dir:?}/var/lib/foundry-ai-tool/syncthing"
  echo "==> drill: Syncthing's device key is not restored (set DRILL_KEEP_SYNCTHING=1 on a real rebuild)"
fi

# The backed-up files belong to the Pi's old foundry user (a number that may differ here).
old_uid="$(stat -c %u "$stage_dir/var/lib/foundry")"
old_gid="$(stat -c %g "$stage_dir/var/lib/foundry")"
echo "==> the Pi's old foundry user was $old_uid:$old_gid, this one is $(id -u foundry):$(id -g foundry)"

echo "==> copying into place (cp -a keeps modes; owners are fixed next)"
cp -a "$stage_dir/var/lib/foundry/." /var/lib/foundry/
cp -a "$stage_dir/var/lib/foundry-ai-tool/." /var/lib/foundry-ai-tool/
cp -a "$stage_dir/etc/foundry-ai-tool/." /etc/foundry-ai-tool/
chown -R foundry:foundry /var/lib/foundry /var/lib/foundry-ai-tool
# /etc/foundry-ai-tool: secrets stay root-owned; only files that were group foundry follow the new group.
find /etc/foundry-ai-tool -gid "$old_gid" -exec chgrp foundry {} +
chgrp foundry /etc/foundry-ai-tool
chmod 2770 /var/lib/foundry-ai-tool/recordings 2>/dev/null || true
rm -rf "${stage_dir:?}"

echo "==> what came back"
echo "    worlds:  $(find /var/lib/foundry/Data/worlds -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"
echo "    systems: $(find /var/lib/foundry/Data/systems -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"
echo "    modules: $(find /var/lib/foundry/Data/modules -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"
echo "    /etc/foundry-ai-tool: $(find /etc/foundry-ai-tool -maxdepth 1 -type f -printf '%f ' | tr ' ' '\n' | sort | tr '\n' ' ')"
echo "### restore wall=$(($(date +%s) - start))s"
# The drill container keeps a timing log; a real Pi has no /drill and needs none.
if [ -d /drill ]; then echo "### restore wall=$(($(date +%s) - start))s" >>/drill/timings.log; fi
