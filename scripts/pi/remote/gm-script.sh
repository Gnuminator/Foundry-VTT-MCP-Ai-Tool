#!/usr/bin/env bash
# Runs one GM script in the running Foundry world as the Assistant GM (docs/dev/PI-SETUP.md,
# "GM scripts"). The script is a local file on the Pi, copied there first; nothing over the
# network starts this, and the bridge and the dashboard cannot. Always a dry run first:
#   scp my-script.js foundry-pi:/root/
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'GM_SCRIPT=/root/my-script.js DRY_RUN=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/gm-script.sh | ssh foundry-pi 'GM_SCRIPT=/root/my-script.js bash -s'
# ENABLE_MODULES="id1 id2" enables installed modules in the world first (a dry run only reports).
# A run that is not a dry run changes the campaign world: a dietpi-backup snapshot and the user's
# OK come first (CLAUDE.md, the Pi rule). It also needs a dry run of the same file (same sha256)
# that ended without an error: a marker in $TOOL_DATA/gm-scripts or the dry run's end line in the
# journal. In an emergency NO_DRY_RUN_REASON="why" skips that check; the reason goes to the journal.
#
# What it does: keeps a copy of the script under $TOOL_DATA/gm-scripts (named by time and sha256),
# stops the Assistant GM service (one Chromium on the Pi, one browser holding the bridge link), runs
# `assistant-gm.mjs script` as the foundry user in a transient systemd unit, so the file, its
# sha256, the mode and the result land in the journal, prints that log, and starts the service
# again, also when the script fails.

require_root
require_arm64
have_systemd || die "needs systemd (the Pi, not a test container)"

script_src="${GM_SCRIPT:?set GM_SCRIPT to the script file on the Pi}"
dry_run="${DRY_RUN:-}"
driver="$TOOL_DIR/gm-browser/assistant-gm.mjs"
env_file="$TOOL_ETC/assistant-gm.env"
service=foundry-ai-tool-gm-browser.service

[ -f "$driver" ] || die "no $driver: run stage 5 first"
[ -f "$env_file" ] || die "no $env_file: the Assistant GM is not set up"
[ -f "$script_src" ] && [ ! -L "$script_src" ] || die "$script_src is not a regular file"

modules=()
for id in ${ENABLE_MODULES:-}; do
  [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "odd module id: $id"
  [ -f "$FOUNDRY_DATA/Data/modules/$id/module.json" ] || die "module $id is not installed"
  modules+=(--enable-module "$id")
done

stamp="$(date +%Y%m%d-%H%M%S)"
sha="$(sha256sum "$script_src" | cut -d' ' -f1)"
sha12="${sha:0:12}"
store="$TOOL_DATA/gm-scripts"
tag=foundry-ai-tool-gm-script

# A real run only after a dry run of the same file passed (a marker here, or the journal).
if [ -z "$dry_run" ]; then
  if compgen -G "$store/*-$sha12-dry-run.ok" >/dev/null \
    || journalctl -t "$tag" -o cat --no-pager 2>/dev/null | grep -q " sha256 $sha (dry run) exit 0$"; then
    ok "a dry run of this script (sha256 $sha12) passed before"
  elif [ -n "${NO_DRY_RUN_REASON:-}" ]; then
    warn "no dry run of this script (sha256 $sha12); going ahead because NO_DRY_RUN_REASON is set: $NO_DRY_RUN_REASON"
    logger -t "$tag" "real run of $script_src sha256 $sha WITHOUT a dry run: $NO_DRY_RUN_REASON"
  else
    die "no passed dry run of this script (sha256 $sha12): run it with DRY_RUN=1 first (in an emergency, NO_DRY_RUN_REASON=\"why\" skips this check and logs the reason)"
  fi
fi

install -d -m 755 "$store"
mode="for real"
copy="$store/$stamp-$sha12.js"
flags=()
if [ -n "$dry_run" ]; then
  mode="dry run"
  copy="$store/$stamp-$sha12-dry-run.js"
  flags=(--dry-run)
fi
install -m 644 "$script_src" "$copy"
args=(script "$copy" "${flags[@]}" "${modules[@]}")
say "GM script $script_src (sha256 $sha, $mode), kept as $copy"
logger -t "$tag" "start $script_src sha256 $sha ($mode)"

was_active=0
if systemctl is-active --quiet "$service"; then
  was_active=1
  systemctl stop "$service"
  ok "stopped $service for the run"
fi
restore() {
  if [ "$was_active" = 1 ]; then
    systemctl start "$service" && ok "started $service again" || warn "$service did not start: journalctl -u $service -n 50"
  fi
}
trap restore EXIT

unit="foundry-ai-tool-gm-script-$stamp"
status=0
systemd-run --quiet --wait --collect --unit="$unit" \
  --uid="$FOUNDRY_USER" --gid="$FOUNDRY_USER" \
  -p EnvironmentFile="$env_file" -p Nice=10 -p NoNewPrivileges=true \
  --setenv=HOME="$TOOL_DATA" --setenv=TOOL_APP="$TOOL_DIR/app" \
  --setenv=FOUNDRY_URL=http://127.0.0.1:30000 --setenv=CHROMIUM=/usr/bin/chromium \
  "$NODE_DIR/bin/node" "$driver" "${args[@]}" || status=$?
journalctl -u "$unit" --no-pager -o cat || true
logger -t "$tag" "end $script_src sha256 $sha ($mode) exit $status"
[ "$status" = 0 ] || die "the GM script failed (exit $status); the log is above (journalctl -u $unit)"
if [ -n "$dry_run" ]; then
  printf 'dry run of %s passed at %s (%s)\n' "$sha" "$stamp" "$script_src" >"$store/$stamp-$sha12-dry-run.ok"
  ok "dry run passed; a real run of this file (sha256 $sha12) may follow after the user's OK"
fi
ok "GM script done ($mode)"
