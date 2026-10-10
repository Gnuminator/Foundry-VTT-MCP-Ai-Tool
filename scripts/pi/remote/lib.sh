#!/usr/bin/env bash
# Shared helpers for the Orange Pi stage scripts (docs/dev/PI-SETUP.md, Part B).
# Claude runs each stage from the PC:  ssh foundry-pi 'bash -s' < scripts/pi/remote/<stage>.sh
# Every stage is safe to run again: it checks what is already there and only adds what is missing.

set -euo pipefail
# Files a stage makes are readable by the services (they run as foundry): never inherit a strict
# umask from the SSH session (stage 9's wrapper once passed on 077, and a stage 5 build came out
# root-only, so the bridge could not start; 2026-10-06). Secrets get their own modes where written.
umask 022

FOUNDRY_USER=foundry
NODE_DIR=/opt/node24
FOUNDRY_APP=/opt/foundry
FOUNDRY_DATA=/var/lib/foundry
TOOL_DIR=/opt/foundry-ai-tool
TOOL_ETC=/etc/foundry-ai-tool
TOOL_DATA=/var/lib/foundry-ai-tool

# A write that fails (the SSH connection dropped, stdout is gone) never stops a stage halfway; with STAGE_LOG set
# (stage 14) every line also goes to that file.
STAGE_LOG=""
out() { # $1 the line, $2 1 for stderr
  if [ "${2:-}" = 1 ]; then printf '%s\n' "$1" >&2 2>/dev/null || true; else printf '%s\n' "$1" 2>/dev/null || true; fi
  [ -z "$STAGE_LOG" ] || printf '%s %s\n' "$(date '+%F %T')" "$1" >>"$STAGE_LOG" 2>/dev/null || true
}
say() { out "==> $*"; }
ok() { out "    ok: $*"; }
warn() { out "    WARNING: $*" 1; }
die() {
  out "ERROR: $*" 1
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "run as root (the Pi's SSH login is root)"
}

require_arm64() {
  local arch
  arch="$(uname -m)"
  [ "$arch" = "aarch64" ] || die "expected an ARM64 board (aarch64), got $arch"
}

# Stage 14's dnd5e trial (docs/dev/PI-SETUP.md, "System trial (stage 14)"): until MODE=switch or MODE=rollback,
# only the kit world may be launched, since every world shares the one dnd5e folder and migrates to the version on
# trial when launched. A stage that launches worlds (or resets the kit) calls this first.
SYSTEM_TRIAL_DIR=/var/lib/foundry-import/system-trial
refuse_during_system_trial() { # $1 the stage, $2... the worlds it launches (none: the stage is refused whenever a trial is open)
  local stage="$1" phase id
  shift
  [ -e "$SYSTEM_TRIAL_DIR" ] || return 0
  phase="$(sed -n 's/^phase=//p' "$SYSTEM_TRIAL_DIR/state" 2>/dev/null | head -n1)" || phase=""
  [ "$phase" != switched ] || return 0
  if [ "$#" -gt 0 ]; then
    for id in "$@"; do [ "$id" = strahd-kit ] || break; done
    [ "$id" != strahd-kit ] || return 0
  fi
  die "a dnd5e system trial is open ($SYSTEM_TRIAL_DIR, phase ${phase:-unknown}): $stage would launch or reset a world on the version on trial. Finish the trial first (stage 14, MODE=switch or MODE=rollback; MODE=status shows it). Nothing was changed"
}

# True when systemd runs (not in a test container).
have_systemd() {
  [ -d /run/systemd/system ]
}

# Install Debian packages that are missing.
apt_install() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    say "installing ${missing[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" >/dev/null
  fi
}

# Write a file only when its content changes; prints whether it did.
write_file() {
  local path="$1" mode="$2" content="$3"
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then
    ok "$path unchanged"
    return 1
  fi
  printf '%s\n' "$content" >"$path"
  chmod "$mode" "$path"
  ok "wrote $path"
  return 0
}

# Enable and (re)start a systemd unit when systemd runs; otherwise only report.
enable_unit() {
  local unit="$1"
  if have_systemd; then
    systemctl daemon-reload
    systemctl enable "$unit" >/dev/null 2>&1
    systemctl restart "$unit"
    sleep 2
    systemctl is-active --quiet "$unit" || die "$unit did not start; see: journalctl -u $unit -n 50"
    ok "$unit running"
  else
    warn "no systemd here (a test container?): $unit written, not started"
  fi
}
