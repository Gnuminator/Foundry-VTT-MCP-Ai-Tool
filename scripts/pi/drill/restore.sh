#!/usr/bin/env bash
# Rebuild drill helper (docs/dev/PI-SETUP.md, "Rebuild drill"), runs inside the drill container.
# The restore step of a rebuild: take the newest snapshot of the PC's restic copy and put the three
# backed-up trees back (/var/lib/foundry, /var/lib/foundry-ai-tool, /etc/foundry-ai-tool) with the
# right owners. Run it after stage 3 (Foundry installed, stopped) and BEFORE stage 6, so the
# restored restic-pi.pass is the one stage 6 builds the new repository with (the PC's copy job
# keeps working with the password it already holds).
# Environment: PC_REPO (default /var/lib/foundry-restore/pc-repo), PC_PASS (default
# /var/lib/foundry-restore/restic-pc.pass), SNAPSHOT (default latest), STAGE_DIR (default
# /var/lib/foundry-restore/restored: the staging folder, inside our own folders; it holds the
# restored secrets and is removed when the script ends, whether it worked or not).
# DRILL_KEEP_SYNCTHING=1 keeps Syncthing's device key (a real rebuild). The repository is only read
# (--no-lock). Only the drill container has a /drill folder (timing log, Syncthing check files).
set -euo pipefail

export RESTIC_REPOSITORY="${PC_REPO:-/var/lib/foundry-restore/pc-repo}"
export RESTIC_PASSWORD_FILE="${PC_PASS:-/var/lib/foundry-restore/restic-pc.pass}"
snapshot="${SNAPSHOT:-latest}"
stage_dir="${STAGE_DIR:-/var/lib/foundry-restore/restored}"
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
# The staging folder holds secrets: root only, and gone again when the script ends.
cleanup() { rm -rf "${stage_dir:?}"; }
trap cleanup EXIT
rm -rf "${stage_dir:?}"
mkdir -p "$(dirname "$stage_dir")"
mkdir -m 0700 "$stage_dir"
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
# /drill/syncthing-expect and /drill/syncthing-old.sha256 let check.sh prove that (the certificate
# is public, not a secret).
syncthing_cert="$stage_dir/var/lib/foundry-ai-tool/syncthing/cert.pem"
if [ -d /drill ] && [ -f "$syncthing_cert" ]; then
  sha256sum "$syncthing_cert" | cut -d' ' -f1 >/drill/syncthing-old.sha256
  if [ "${DRILL_KEEP_SYNCTHING:-0}" = 1 ]; then echo same >/drill/syncthing-expect; else echo different >/drill/syncthing-expect; fi
fi
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
# Stage 9's SSH log is root only (0700 folders, 0600 files): the chown above must not hand it to foundry.
if [ -d /var/lib/foundry-ai-tool/ssh-log ]; then
  chown -R root:root /var/lib/foundry-ai-tool/ssh-log
  find /var/lib/foundry-ai-tool/ssh-log -type d -exec chmod 0700 {} +
  find /var/lib/foundry-ai-tool/ssh-log -type f -exec chmod 0600 {} +
fi
cleanup
trap - EXIT

echo "==> what came back"
echo "    worlds:  $(find /var/lib/foundry/Data/worlds -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"
echo "    systems: $(find /var/lib/foundry/Data/systems -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"
echo "    modules: $(find /var/lib/foundry/Data/modules -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"
echo "    /etc/foundry-ai-tool: $(find /etc/foundry-ai-tool -maxdepth 1 -type f -printf '%f ' | tr ' ' '\n' | sort | tr '\n' ' ')"
echo "### restore wall=$(($(date +%s) - start))s"
# The drill container keeps a timing log; a real Pi has no /drill and needs none.
if [ -d /drill ]; then echo "### restore wall=$(($(date +%s) - start))s" >>/drill/timings.log; fi
