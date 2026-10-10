#!/usr/bin/env bash
# Stage 12 (Part C): Cloudflare Tunnel, so the players reach Foundry (and the GM the dashboard)
# through Cloudflare Access without any port open on the router (D-075; docs/dev/REMOTE-ACCESS.md,
# "Part C"). The tunnel only dials out. Which public names point at which local port is set in the
# Cloudflare dashboard (a remotely managed tunnel), not on the Pi. This stage touches no firewall,
# no SSH, network or Tailscale setting.
#
# What it does:
#   - cloudflared from Cloudflare's own signed apt repository (arm64). The repository key is pinned
#     by its fingerprint: a different key stops the stage.
#   - a systemd service, foundry-ai-tool-cloudflared, in token mode. The tunnel token is read from the
#     root-only file /etc/foundry-ai-tool/cloudflared-token through systemd's LoadCredential, so it is
#     never on a command line, in the unit file or in an environment. The service runs as a throwaway
#     user (DynamicUser): no user is created. The unit refuses to start while the token file is missing.
#   - optional: FOUNDRY_PUBLIC_HOST=play.example.com sets Foundry's proxy options (hostname, proxySSL,
#     proxyPort 443) so invitation links and A/V use the public name; Foundry restarts if that changes them.
#   - a check: the service is active and cloudflared reports a connection to Cloudflare.
# Before any of that, the stage refuses to go on while any world on the Pi has a Gamemaster or Assistant GM
# with no password (#273; gm_password_check in lib.sh, read-only; gm-passwords.sh runs it on its own):
# through the tunnel, anyone past Cloudflare Access could pick that user on the join page.
# The token: the user runs set-tunnel-token.sh in their own SSH session (it asks for the token without
# showing it); Claude never types or sees it. Until the file exists, this stage installs everything and
# leaves the service stopped.
# Claude runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/12-tunnel.sh | ssh foundry-pi 'bash -s'
#   (with the public name:  ... | ssh foundry-pi 'FOUNDRY_PUBLIC_HOST=play.example.com bash -s')
# Safe to run again. Test container: the stage skips what needs systemd.

require_root
require_arm64

# ---- no GM without a password (#273) ----------------------------------------------------------------
say "GM passwords in every world"
gm_rc=0
gm_password_check || gm_rc=$?
case "$gm_rc" in
  0) ok "every world's Gamemaster and Assistant GM users have a password" ;;
  3) die "a world above has a Gamemaster or Assistant GM with no password (or no Gamemaster, so its next launch makes one): set a password for each (in that world: Game Settings, User Management), then run this stage again. Nothing was changed" ;;
  *) die "the GM password check could not read every world (see above): nothing was changed" ;;
esac

unit=foundry-ai-tool-cloudflared.service
token_file="$TOOL_ETC/cloudflared-token"
keyring=/usr/share/keyrings/cloudflare-main.gpg
sources=/etc/apt/sources.list.d/cloudflared.list
key_url=https://pkg.cloudflare.com/cloudflare-main.gpg
# "CloudFlare Software Packaging 2025 <help@cloudflare.com>", the key that signs the cloudflared
# repository's InRelease (checked 2026-10-06). If Cloudflare rotates it, the stage stops here:
# check the new fingerprint on Cloudflare's downloads page, then change this line in a PR.
key_fpr=CC94B39C77AE7342A68B89628A682D308D4E5E73
metrics=127.0.0.1:20241
public_host="${FOUNDRY_PUBLIC_HOST:-}"

# True when the token file holds something shaped like a tunnel token: base64 of JSON with the
# account tag (a), the tunnel id (t) and the secret (s). Prints nothing.
token_looks_valid() {
  local tok
  tok="$(tr -d '[:space:]' <"$1" 2>/dev/null)" || return 1
  [ -n "$tok" ] || return 1
  local json
  json="$(printf '%s' "$tok" | base64 -d 2>/dev/null)" || return 1
  printf '%s' "$json" | grep -q '"a"[[:space:]]*:' &&
    printf '%s' "$json" | grep -q '"t"[[:space:]]*:' &&
    printf '%s' "$json" | grep -q '"s"[[:space:]]*:'
}

# ---- cloudflared from Cloudflare's apt repository ---------------------------------------------------
say "cloudflared"
apt_install ca-certificates curl gnupg
# The primary key's fingerprint of a key file, or nothing unless the file holds exactly one primary key
# (a file with a second key in it must not pass on the first one's fingerprint).
key_fpr_of() {
  gpg --show-keys --with-colons "$1" 2>/dev/null | awk -F: '
    $1 == "pub" { pubs++ }
    $1 == "fpr" && !fpr { fpr = $10 }
    END { if (pubs == 1) print fpr }'
}
if [ -f "$keyring" ] && [ "$(key_fpr_of "$keyring")" = "$key_fpr" ]; then
  ok "repository key already in place ($key_fpr)"
else
  key_tmp="$(mktemp /tmp/cloudflare-key.XXXXXX)"
  trap 'rm -f "${key_tmp:?}"' EXIT
  curl -fsSL "$key_url" -o "$key_tmp"
  got="$(key_fpr_of "$key_tmp")"
  [ "$got" = "$key_fpr" ] ||
    die "the key at $key_url has fingerprint '${got:-none}', not the pinned $key_fpr: nothing was installed. Check Cloudflare's downloads page before changing the pin."
  install -d -m 0755 /usr/share/keyrings
  install -m 0644 "$key_tmp" "$keyring"
  rm -f "${key_tmp:?}"
  trap - EXIT
  ok "repository key $key_fpr installed"
fi
sources_changed=0
if write_file "$sources" 0644 "deb [arch=arm64 signed-by=$keyring] https://pkg.cloudflare.com/cloudflared any main"; then
  sources_changed=1
fi
if [ "$sources_changed" = 1 ] || ! command -v cloudflared >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  apt_install cloudflared
fi
command -v cloudflared >/dev/null 2>&1 || die "cloudflared is not installed"
ok "$(cloudflared --version | head -n 1)"
bin="$(command -v cloudflared)"
# Updates come through apt (and this stage); the package's own self-update timer stays off.
if have_systemd; then
  systemctl disable --now cloudflared-update.timer >/dev/null 2>&1 || true
fi

# ---- the service ------------------------------------------------------------------------------------
say "the service"
unit_body="[Unit]
Description=Cloudflare Tunnel for Foundry and the dashboard (D-075)
After=network-online.target
Wants=network-online.target
# No token file, no start. The token is put there by set-tunnel-token.sh (the user runs it).
AssertPathExists=$token_file

[Service]
Type=simple
# A throwaway user, so no account is created. systemd (root) reads the token file and hands it over
# as a private credential file; %d is that folder. The token is never an argument or an environment.
DynamicUser=yes
LoadCredential=tunnel-token:$token_file
ExecStart=$bin --no-autoupdate tunnel --metrics $metrics run --token-file %d/tunnel-token
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target"
unit_changed=0
if write_file "/etc/systemd/system/$unit" 0644 "$unit_body"; then unit_changed=1; fi

# Stage 1 made it 0750 root:foundry; never loosen it here.
[ -d "$TOOL_ETC" ] || die "$TOOL_ETC is missing: run stage 1 first"
has_token=0
if [ -f "$token_file" ]; then
  chown root:root "$token_file"
  chmod 0600 "$token_file"
  if token_looks_valid "$token_file"; then
    has_token=1
    ok "$token_file is there (root only, 0600; not shown)"
  else
    warn "$token_file does not look like a tunnel token: run set-tunnel-token.sh again (copy the token from the Cloudflare tunnel page)"
  fi
fi

if [ "$has_token" = 0 ]; then
  warn "no usable tunnel token yet: the service stays off."
  warn "next step: in the Cloudflare dashboard create the tunnel and copy its token (docs/dev/REMOTE-ACCESS.md, Part C), then in your own SSH session run set-tunnel-token.sh; it starts the tunnel."
fi
if ! have_systemd; then
  warn "no systemd here (a test container?): $unit written, not started"
elif [ "$has_token" = 0 ]; then
  systemctl daemon-reload
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
elif [ "$unit_changed" = 1 ] || ! systemctl is-active --quiet "$unit"; then
  enable_unit "$unit"
else
  systemctl enable "$unit" >/dev/null 2>&1
  ok "$unit already running"
fi

# ---- Foundry behind the proxy (optional) ------------------------------------------------------------
say "Foundry's proxy options"
options="$FOUNDRY_DATA/Config/options.json"
if [ -z "$public_host" ]; then
  ok "FOUNDRY_PUBLIC_HOST not given: options.json left as it is. Without hostname, proxySSL and proxyPort 443, invitation links and A/V use the wrong address; run this stage again with FOUNDRY_PUBLIC_HOST=<the players' name> once you know it"
else
  [[ "$public_host" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] ||
    die "FOUNDRY_PUBLIC_HOST must be a plain host name such as play.example.com (got '$public_host')"
  [ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
  [ -f "$options" ] || die "no $options: has Foundry started once (stage 3)?"
  export PATH="$NODE_DIR/bin:$PATH"
  current="$(node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write([o.hostname, o.proxySSL, o.proxyPort].join(" "));
  ' "$options")"
  if [ "$current" = "$public_host true 443" ]; then
    ok "options.json already has hostname $public_host, proxySSL true, proxyPort 443"
  else
    # Foundry may rewrite options.json when it stops, so it is stopped before the edit. Each run keeps
    # its own copy (a rerun never overwrites an older one); if anything fails while Foundry is stopped,
    # that copy is put back and Foundry is started again.
    run_backup="$options.before-tunnel.$(date +%Y%m%d-%H%M%S)"
    in_edit=0
    restore_foundry() {
      local rc=$?
      trap - EXIT
      if [ "$rc" -ne 0 ] && [ "$in_edit" = 1 ]; then
        cp -a "$run_backup" "$options" || true
        if have_systemd; then systemctl start foundry.service || true; fi
        printf 'ERROR: stage 12 failed while Foundry was stopped: options.json put back from %s and Foundry started again\n' "$run_backup" >&2
      fi
      exit "$rc"
    }
    trap restore_foundry EXIT
    cp -a "$options" "$run_backup"
    in_edit=1
    if have_systemd; then systemctl stop foundry.service; fi
    node -e '
      const fs = require("fs");
      const [p, host] = process.argv.slice(1);
      const o = JSON.parse(fs.readFileSync(p, "utf8"));
      o.hostname = host;
      o.proxySSL = true;
      o.proxyPort = 443;
      fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
    ' "$options" "$public_host"
    chown --reference="$run_backup" "$options"
    ok "options.json: hostname $public_host, proxySSL true, proxyPort 443 (old file: $run_backup)"
    if have_systemd; then
      systemctl start foundry.service
      ok "Foundry restarted (players in a session reconnect by themselves)"
    else
      warn "no systemd here (a test container?): Foundry not restarted"
    fi
    in_edit=0
    trap - EXIT
  fi
fi

# ---- the check --------------------------------------------------------------------------------------
say "the check"
if ! have_systemd; then
  warn "no systemd here (a test container?): the service check is skipped"
elif [ "$has_token" = 0 ]; then
  warn "skipped: the tunnel has no token yet"
else
  ready=""
  for _ in $(seq 1 45); do
    ready="$(curl -fs "http://$metrics/ready" 2>/dev/null || true)"
    case "$ready" in *'"status":200'*) break ;; esac
    sleep 2
  done
  if systemctl is-active --quiet "$unit"; then ok "$unit is active"; else warn "$unit is not active: journalctl -u $unit -n 30"; fi
  case "$ready" in
    *'"status":200'*) ok "cloudflared reports a connection to Cloudflare: $ready" ;;
    *) warn "cloudflared is not connected to Cloudflare yet (token wrong, tunnel deleted, or no outbound access); see: journalctl -u $unit -n 30" ;;
  esac
  listening="$(ss -ltnpH 2>/dev/null | grep cloudflared || true)"
  if [ -n "$listening" ] && printf '%s\n' "$listening" | grep -v " $metrics " | grep -q .; then
    warn "cloudflared listens on something besides $metrics: $listening"
  else
    ok "cloudflared listens only on $metrics (loopback); the tunnel itself is outbound"
  fi
  # The two local origins the Cloudflare dashboard routes to (a dead one gives players a 502).
  for origin in "30000 Foundry" "3000 the dashboard"; do
    port="${origin%% *}"
    if curl -fs -o /dev/null "http://127.0.0.1:$port/"; then ok "${origin#* } answers on 127.0.0.1:$port"; else warn "${origin#* } does not answer on 127.0.0.1:$port: a public name routed there would show a 502"; fi
  done
fi

say "stage 12 done: cloudflared $(cloudflared --version | awk 'NR == 1 { print $3 }'), token $([ "$has_token" = 1 ] && echo set || echo 'not set yet'). Next: finish the hostnames and Cloudflare Access in the Cloudflare dashboard (Part C)"
