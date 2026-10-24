#!/usr/bin/env bash
# Stage 3: Foundry VTT as a service on port 30000.
# Needs the "Linux/Node.js" build zip from the user's foundryvtt.com account, copied to the Pi
# first (Claude: scp <zip> foundry-pi:/root/foundryvtt.zip). The licence key and the admin
# password are entered by the user in their browser on first start, never here.
# FOUNDRY_ZIP overrides the zip path. FOUNDRY_EXPECT_VERSION (for example 14.369) refuses a zip of another version.

require_root
require_recent_snapshot
require_arm64
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"

zip="${FOUNDRY_ZIP:-/root/foundryvtt.zip}"

# From the moment Foundry is stopped until the new program has started, a failure puts things back: the old program
# (kept as $FOUNDRY_APP.prev) goes back in place once the swap moved it aside (prev_moved), and Foundry is started
# again, so a failed run never leaves the Pi without a Foundry. A failure while .prev itself is being removed (before
# prev_moved) leaves the running program alone and only starts Foundry. The zip stays until the new program answers,
# so the stage can be run again. The trap runs without `set -e` (a failing command would otherwise end it halfway),
# restores first, starts Foundry, and only then tidies up.
foundry_stopped=0
prev_moved=0
zip_installed=0
stage3_exit() {
  local rc=$?
  trap - EXIT
  set +e
  if [ "$rc" -ne 0 ] && { [ "$foundry_stopped" = 1 ] || [ "$prev_moved" = 1 ]; }; then
    warn "stage 3 failed after Foundry was stopped: putting the old program back and starting Foundry again"
    if have_systemd; then systemctl stop foundry.service; fi
    if [ "$prev_moved" = 1 ] && [ -d "$FOUNDRY_APP.prev" ]; then
      rm -rf "${FOUNDRY_APP:?}.failed"
      if [ ! -d "$FOUNDRY_APP" ] || mv "$FOUNDRY_APP" "$FOUNDRY_APP.failed"; then
        if mv "$FOUNDRY_APP.prev" "$FOUNDRY_APP"; then
          ok "the old Foundry program is back in $FOUNDRY_APP (the zip is still there: run the stage again once the cause is fixed)"
        else
          warn "could not put $FOUNDRY_APP.prev back: restore it by hand (mv $FOUNDRY_APP.prev $FOUNDRY_APP)"
        fi
      else
        warn "could not move the new program away from $FOUNDRY_APP; the old one is in $FOUNDRY_APP.prev"
      fi
    fi
    if [ "$foundry_stopped" = 1 ] && have_systemd; then
      systemctl start foundry.service || warn "could not start foundry.service; see: journalctl -u foundry -n 50"
    fi
    rm -rf "${FOUNDRY_APP:?}.failed" "${FOUNDRY_APP:?}.new"
  fi
  [ -z "${tmp:-}" ] || rm -rf "${tmp:?}"
  exit "$rc"
}

say "Foundry program"
if [ -f "$zip" ]; then
  tmp="$(mktemp -d)"
  trap stage3_exit EXIT
  unzip -q "$zip" -d "$tmp"
  [ -f "$tmp/main.js" ] || die "$zip is not the Linux/Node.js build (no main.js at its top level)"
  version="$(awk -F'"' '/"version"/ { print $4; exit }' "$tmp/package.json" 2>/dev/null || true)"
  # FOUNDRY_EXPECT_VERSION=14.369 (a prefix of the zip's version, so 14.369 matches 14.369.0) refuses any other build
  # before anything stops: the wrong zip in /root is the one mistake a new Foundry version can make here.
  if [ -n "${FOUNDRY_EXPECT_VERSION:-}" ]; then
    case "${version:-}" in
      "$FOUNDRY_EXPECT_VERSION" | "$FOUNDRY_EXPECT_VERSION".*) ;;
      *) die "$zip holds Foundry ${version:-?}, not FOUNDRY_EXPECT_VERSION=$FOUNDRY_EXPECT_VERSION. Nothing was changed" ;;
    esac
  fi
  require_quiet "installing a new Foundry program (it stops Foundry)"
  # The new program is staged next to the old one and swapped in with two renames (never `rm -rf dir/*`
  # first, which left an empty program folder when the copy failed). The old one stays as
  # $FOUNDRY_APP.prev for a quick rollback; the data is in $FOUNDRY_DATA and is not touched.
  new="${FOUNDRY_APP:?}.new"
  rm -rf "${new:?}"
  mkdir -p "$new"
  cp -a "$tmp"/. "$new"/
  chown -R root:root "$new"
  # `cp -a "$tmp"/.` also copies mktemp's 0700 mode onto the folder, which locked the foundry user
  # out of its own program folder on the real Pi (2026-10-04).
  chmod 755 "$new"
  [ -f "$new/main.js" ] || die "the staged Foundry in $new has no main.js; $FOUNDRY_APP was not touched"
  if have_systemd && systemctl is-active --quiet foundry.service; then
    systemctl stop foundry.service
    foundry_stopped=1
  fi
  rm -rf "${FOUNDRY_APP:?}.prev"
  if [ -d "$FOUNDRY_APP" ]; then
    mv "$FOUNDRY_APP" "$FOUNDRY_APP.prev"
    prev_moved=1
  fi
  mv "$new" "$FOUNDRY_APP"
  mark_changed /etc/systemd/system/foundry.service
  ok "installed Foundry ${version:-?} in $FOUNDRY_APP (data stays in $FOUNDRY_DATA)"
  zip_installed=1
elif [ -f "$FOUNDRY_APP/main.js" ]; then
  ok "Foundry already installed in $FOUNDRY_APP (no new zip given)"
else
  die "no Foundry zip at $zip and nothing installed yet"
fi

say "the foundry service"
unit="[Unit]
Description=Foundry VTT
After=network-online.target
Wants=network-online.target

[Service]
User=$FOUNDRY_USER
Group=$FOUNDRY_USER
WorkingDirectory=$FOUNDRY_APP
ExecStart=$NODE_DIR/bin/node $FOUNDRY_APP/main.js --dataPath=$FOUNDRY_DATA --port=30000 --noupnp
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$FOUNDRY_DATA

[Install]
WantedBy=multi-user.target"
write_file /etc/systemd/system/foundry.service 0644 "$unit" || true
enable_unit foundry.service
# The new program runs: nothing to put back any more.
foundry_stopped=0
prev_moved=0

if have_systemd; then
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null http://127.0.0.1:30000/ && break
    sleep 2
  done
  if curl -fs -o /dev/null http://127.0.0.1:30000/; then
    ok "Foundry answers on port 30000: open http://$(hostname).local:30000 on the PC"
  else
    warn "Foundry did not answer on port 30000 yet; see: journalctl -u foundry -n 50 (the zip is kept until it answers)"
    zip_installed=0
  fi
fi
# The zip goes only once the new program has answered, so a crash after the start still leaves it to run the stage again.
if [ "$zip_installed" = 1 ]; then rm -f "$zip"; fi

say "stage 3 done: enter the licence key and an admin password in the browser"
