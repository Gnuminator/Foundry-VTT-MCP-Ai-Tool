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
# The token: the user runs set-tunnel-token.sh in their own SSH session (it asks for the token without
# showing it); Claude never types or sees it. Until the file exists, this stage installs everything and
# leaves the service stopped.
# Claude runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/12-tunnel.sh | ssh foundry-pi 'bash -s'
#   (with the public name:  ... | ssh foundry-pi 'FOUNDRY_PUBLIC_HOST=play.example.com bash -s')
# Safe to run again. Test container: the stage skips what needs systemd.

require_root
require_arm64

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
key_fpr_of() { gpg --show-keys --with-colons "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }'; }
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

install -d -m 0755 -o root -g root "$TOOL_ETC"
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
    # Foundry may rewrite options.json when it stops, so it is stopped before the edit.
    if have_systemd; then systemctl stop foundry.service; fi
    cp -a "$options" "$options.before-tunnel"
    node -e '
      const fs = require("fs");
      const [p, host] = process.argv.slice(1);
      const o = JSON.parse(fs.readFileSync(p, "utf8"));
      o.hostname = host;
      o.proxySSL = true;
      o.proxyPort = 443;
      fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
    ' "$options" "$public_host"
    chown --reference="$options.before-tunnel" "$options"
    ok "options.json: hostname $public_host, proxySSL true, proxyPort 443 (old file: $options.before-tunnel)"
    if have_systemd; then
      systemctl start foundry.service
      ok "Foundry restarted (players in a session reconnect by themselves)"
    else
      warn "no systemd here (a test container?): Foundry not restarted"
    fi
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
