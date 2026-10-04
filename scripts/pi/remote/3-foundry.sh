#!/usr/bin/env bash
# Stage 3: Foundry VTT as a service on port 30000.
# Needs the "Linux/Node.js" build zip from the user's foundryvtt.com account, copied to the Pi
# first (Claude: scp <zip> foundry-pi:/root/foundryvtt.zip). The licence key and the admin
# password are entered by the user in their browser on first start, never here.
# FOUNDRY_ZIP overrides the zip path.

require_root
require_arm64
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"

zip="${FOUNDRY_ZIP:-/root/foundryvtt.zip}"

say "Foundry program"
if [ -f "$zip" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  unzip -q "$zip" -d "$tmp"
  [ -f "$tmp/main.js" ] || die "$zip is not the Linux/Node.js build (no main.js at its top level)"
  version="$(awk -F'"' '/"version"/ { print $4; exit }' "$tmp/package.json" 2>/dev/null || true)"
  if have_systemd && systemctl is-active --quiet foundry.service; then
    systemctl stop foundry.service
  fi
  rm -rf "${FOUNDRY_APP:?}"/*
  cp -a "$tmp"/. "$FOUNDRY_APP"/
  chown -R root:root "$FOUNDRY_APP"
  # `cp -a "$tmp"/.` also copies mktemp's 0700 mode onto the folder, which locked the foundry user
  # out of its own program folder on the real Pi (2026-10-04).
  chmod 755 "$FOUNDRY_APP"
  ok "installed Foundry ${version:-?} in $FOUNDRY_APP (data stays in $FOUNDRY_DATA)"
  rm -f "$zip"
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

if have_systemd; then
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null http://127.0.0.1:30000/ && break
    sleep 2
  done
  if curl -fs -o /dev/null http://127.0.0.1:30000/; then
    ok "Foundry answers on port 30000: open http://$(hostname).local:30000 on the PC"
  else
    warn "Foundry did not answer on port 30000 yet; see: journalctl -u foundry -n 50"
  fi
fi

say "stage 3 done: enter the licence key and an admin password in the browser"
