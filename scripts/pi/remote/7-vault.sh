#!/usr/bin/env bash
# Stage 7: the GM vault on the Pi, and Syncthing to carry it to the GM's PC. The bridge writes the
# Obsidian notes (session log, changes, stats, the Library) into /var/lib/foundry-ai-tool/obsidian/gm;
# Syncthing copies that folder to every PC that has been added, and takes the GM's own notes back
# (so the nightly restic backup holds them too). The player vault waits for O7 (D-091).
# Claude runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/7-vault.sh | ssh foundry-pi 'bash -s'
# Optional settings (environment variables, put before `bash -s`):
#   PEER_ID / PEER_NAME  also add that PC's Syncthing device and share the vault with it
#   OPEN_BASE            the address "Open in Foundry" links use (default: the one already in
#                        bridge.env, else the dashboard's Tailscale name; Part C sets the Cloudflare name)
#   VAULT_NAME           the vault's folder name on the receiving PC (default "Foundry GM vault")
# The Foundry mirror switch ("AI Tool: Obsidian mirror (writes)" plus the guarded plan-obsidian-mirror
# tool) stays off: that is the GM's decision per world (D-083). The session, change and stats notes
# are written whenever FOUNDRY_AI_OBSIDIAN_DIR is set, mirror or not.

require_root
[ -d "$TOOL_DIR/app" ] || die "the tool is missing: run stage 5 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"

obsidian_dir="$TOOL_DATA/obsidian"
gm_dir="$obsidian_dir/gm"
st_home="$TOOL_DATA/syncthing"
st_log="$st_home/serve.log"
st_gui="127.0.0.1:8384"
folder_id="foundry-gm-vault"
folder_label="Foundry GM vault"
vault_name="${VAULT_NAME:-Foundry GM vault}"
peer_id="${PEER_ID:-}"
peer_name="${PEER_NAME:-peer}"

# The dashboard env file below quotes the name, so keep it free of anything that breaks the quoting.
case "$vault_name" in
*[\"\\\$\`]* | *$'\n'*) die "VAULT_NAME must not contain quotes, backslashes, \$, backticks or line breaks" ;;
esac
if [ -n "$peer_id" ]; then
  printf '%s' "$peer_id" | grep -Eq '^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$' ||
    die "PEER_ID is not a Syncthing device ID (eight groups of seven letters and digits)"
fi

say "folders"
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$obsidian_dir" "$gm_dir"
install -d -m 0700 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$st_home"
ok "$gm_dir (Syncthing's own files go in $st_home, never in $FOUNDRY_DATA)"

# The Pi's name on the tailnet, for the "Open in Foundry" links (same lookup as stage 5).
ts_name=""
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  ts_name="$(tailscale status --json | "$NODE_DIR/bin/node" -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).Self?.DNSName||"";process.stdout.write(n.replace(/\.$/,""))})')"
fi
# OPEN_BASE wins; then the address an earlier run (or the user, in Part C) put in the file; then Tailscale.
open_base="${OPEN_BASE:-}"
if [ -z "$open_base" ] && [ -f "$TOOL_ETC/bridge.env" ]; then
  open_base="$(sed -n 's/^FOUNDRY_AI_OPEN_BASE=//p' "$TOOL_ETC/bridge.env" | tail -n 1)"
fi
if [ -z "$open_base" ] && [ -n "$ts_name" ]; then
  open_base="http://$ts_name:3000"
fi

say "the bridge's Obsidian output"
# These two files belong to this script: it rewrites them whole, so keep other settings elsewhere.
bridge_env="# Written by scripts/pi/remote/7-vault.sh; edit it there (the file is rewritten whole).
FOUNDRY_AI_OBSIDIAN_DIR=$gm_dir
FOUNDRY_AI_FOUNDRY_URL=http://127.0.0.1:30000"
if [ -n "$open_base" ]; then
  bridge_env="$bridge_env
FOUNDRY_AI_OPEN_BASE=$open_base"
else
  warn "no Tailscale name and no OPEN_BASE: 'Open in Foundry' links stay off until you run this again with OPEN_BASE=http://<address>:3000"
fi
dashboard_env="# Written by scripts/pi/remote/7-vault.sh; edit it there (the file is rewritten whole).
OBSIDIAN_VAULT_NAME=\"$vault_name\""
mkdir -p "$TOOL_ETC"
bridge_changed=0
dashboard_changed=0
if write_file "$TOOL_ETC/bridge.env" 0640 "$bridge_env"; then bridge_changed=1; fi
if write_file "$TOOL_ETC/dashboard.env" 0640 "$dashboard_env"; then dashboard_changed=1; fi
# Root writes them, the services (user foundry) read them.
chown "root:$FOUNDRY_USER" "$TOOL_ETC/bridge.env" "$TOOL_ETC/dashboard.env"
if have_systemd; then
  if [ "$bridge_changed" = 1 ] && [ -f /etc/systemd/system/foundry-ai-tool-bridge.service ]; then
    systemctl restart foundry-ai-tool-bridge.service
    ok "bridge restarted with the new settings"
  fi
  if [ "$dashboard_changed" = 1 ] && [ -f /etc/systemd/system/foundry-ai-tool-dashboard.service ]; then
    systemctl restart foundry-ai-tool-dashboard.service
    ok "dashboard restarted with the new settings"
  fi
else
  warn "no systemd here (a test container?): the services were not restarted"
fi

say "Syncthing"
apt_install syncthing
ok "$(syncthing --version | head -n 1)"

# Its own unit, not Debian's syncthing@.service: that one would keep Syncthing's files in the
# foundry user's home, which is Foundry's data folder. --skip-port-probing keeps the GUI address in
# its config equal to --gui-address, because `syncthing cli` reads the address from the config.
# The GUI (and so the API) listens on loopback only; peers connect on port 22000 (TCP and QUIC).
syncthing_unit="[Unit]
Description=Foundry AI Tool Syncthing (the GM vault; GUI on 127.0.0.1:8384)
After=network-online.target
Wants=network-online.target

[Service]
User=$FOUNDRY_USER
Group=$FOUNDRY_USER
Environment=HOME=$TOOL_DATA
ExecStart=/usr/bin/syncthing serve --no-browser --no-restart --no-default-folder --skip-port-probing --no-upgrade --home=$st_home --gui-address=$st_gui
Restart=on-failure
RestartSec=10
Nice=10
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ReadWritePaths=$TOOL_DATA

[Install]
WantedBy=multi-user.target"
unit_changed=0
if write_file /etc/systemd/system/foundry-ai-tool-syncthing.service 0644 "$syncthing_unit"; then unit_changed=1; fi

# Syncthing as the foundry user, with its files under the tool's storage.
st() { runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" syncthing cli --home="$st_home" "$@"; }
st_up() { st show system >/dev/null 2>&1; }

if have_systemd; then
  if [ "$unit_changed" = 1 ] || ! systemctl is-active --quiet foundry-ai-tool-syncthing.service; then
    enable_unit foundry-ai-tool-syncthing.service
  else
    systemctl enable foundry-ai-tool-syncthing.service >/dev/null 2>&1
    ok "foundry-ai-tool-syncthing.service already running"
  fi
elif st_up; then
  ok "Syncthing already runs by hand (no systemd here)"
else
  warn "no systemd here (a test container?): starting Syncthing by hand in the background as $FOUNDRY_USER; it stops with the container"
  : >>"$st_log"
  chown "$FOUNDRY_USER:$FOUNDRY_USER" "$st_log"
  runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" nohup syncthing serve --no-browser --no-restart \
    --no-default-folder --skip-port-probing --no-upgrade --home="$st_home" --gui-address="$st_gui" \
    >>"$st_log" 2>&1 </dev/null &
fi
for _ in $(seq 1 60); do
  st_up && break
  sleep 1
done
st_up || die "Syncthing does not answer; see: journalctl -u foundry-ai-tool-syncthing -n 50 (or $st_log)"
[ "$(st config gui raw-address get)" = "$st_gui" ] ||
  die "Syncthing's GUI address is $(st config gui raw-address get), not $st_gui: fix $st_home/config.xml first"

say "Syncthing settings"
# Set an option when it differs. `--` lets a negative number through (urAccepted -1).
st_opt() {
  local name="$1" want="$2" have
  have="$(st config options "$name" get)"
  if [ "$have" = "$want" ]; then
    ok "$name already $want"
  else
    st config options "$name" set -- "$want"
    ok "$name: $have -> $want"
  fi
}
# Never ask the router to open a port (the user's rule, like Foundry's --noupnp); no usage reports or
# crash reports. Global discovery and relays stay on so the GM's PC outside the home can still sync:
# relays only carry traffic that is end-to-end encrypted.
st_opt natenabled false
st_opt uraccepted -1
st_opt crenabled false
st_opt global-ann-enabled true
st_opt relays-enabled true

say "the GM vault folder"
# .stignore is per device (Syncthing does not sync it), so the PC script writes the same file.
stignore="// Per-device Obsidian state: each PC keeps its own (written by 7-vault.sh and setup-syncthing-pc.ps1).
.obsidian/workspace*.json
.obsidian/cache
.trash"
write_file "$gm_dir/.stignore" 0640 "$stignore" || true
chown "$FOUNDRY_USER:$FOUNDRY_USER" "$gm_dir/.stignore"
if st config folders list | grep -x "$folder_id" >/dev/null; then
  ok "folder $folder_id already there"
  [ "$(st config folders "$folder_id" path get)" = "$gm_dir" ] ||
    warn "folder $folder_id points at $(st config folders "$folder_id" path get), not $gm_dir"
  [ "$(st config folders "$folder_id" type get)" = "sendreceive" ] ||
    st config folders "$folder_id" type set sendreceive
else
  st config folders add --id "$folder_id" --label "$folder_label" --path "$gm_dir" --type sendreceive
  ok "added folder $folder_id (send and receive) at $gm_dir"
fi

if [ -n "$peer_id" ]; then
  say "sharing with $peer_name"
  if st config devices list | grep -x "$peer_id" >/dev/null; then
    ok "device $peer_name already known"
  else
    # No --addresses flag: the new device gets `dynamic` (discovery), and the PC dials the Pi anyway.
    st config devices add --device-id "$peer_id" --name "$peer_name"
    ok "added device $peer_name"
  fi
  [ "$(st config devices "$peer_id" auto-accept-folders get)" = "false" ] ||
    st config devices "$peer_id" auto-accept-folders set false
  if st config folders "$folder_id" devices list | grep -x "$peer_id" >/dev/null; then
    ok "$folder_id already shared with $peer_name"
  else
    st config folders "$folder_id" devices add --device-id "$peer_id"
    ok "shared $folder_id with $peer_name"
  fi
fi

say "this Pi's Syncthing"
my_id="$(st show system | sed -n 's/.*"myID": "\([A-Z0-9-]*\)".*/\1/p')"
[ -n "$my_id" ] || die "could not read the Pi's device ID"
echo "    device ID: $my_id"
echo "    folder:    $folder_id ($gm_dir)"
echo "    options:   natenabled=$(st config options natenabled get) uraccepted=$(st config options uraccepted get) crenabled=$(st config options crenabled get)"
echo "    shared with: $(st config folders "$folder_id" devices list | grep -vx "$my_id" | tr '\n' ' ')"

say "stage 7 done: GM vault $gm_dir; on each receiving PC run scripts/pi/setup-syncthing-pc.ps1 -PiDeviceId $my_id, then run this stage again with PEER_ID=<that PC's device ID>"
