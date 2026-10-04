#!/usr/bin/env bash
# Stage 4: Tailscale for private admin access (SSH and the bridge from the PC; D-075: not for the
# players). From Tailscale's own apt repository for Debian 13, signed with its published key.
# `tailscale up` prints a login link for the user; Claude never logs in.

require_root
require_arm64

say "Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg \
    -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list \
    -o /etc/apt/sources.list.d/tailscale.list
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  apt_install tailscale
  ok "installed $(tailscale version | head -n1)"
else
  ok "already installed: $(tailscale version | head -n1)"
fi

if have_systemd; then
  systemctl enable --now tailscaled >/dev/null 2>&1
  if tailscale status >/dev/null 2>&1; then
    ok "logged in: $(tailscale status --self --peers=false 2>/dev/null | head -n1)"
  else
    say "log in: open the link below in your browser on the PC (it is yours to approve)"
    tailscale up --hostname="$(hostname)" --timeout=10m
    ok "logged in"
  fi
else
  warn "no systemd here (a test container?): tailscaled not started"
fi

say "stage 4 done"
