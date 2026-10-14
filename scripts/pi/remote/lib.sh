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

say() { printf '==> %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
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

# ---- Writes into folders the foundry user owns --------------------------------------------------------
# Root must not write there: a link the foundry user left at the destination (or at a temp name) would make root
# write over any file, and a chown would hand it to the foundry user. These two helpers run the write as the foundry
# user, to a temp file next to the target (same mode) that is renamed over it, so a failure never leaves a half file
# and the target keeps its mode (its owner becomes the foundry user). The temp name is <target>.foundry-tmp; a leftover or a link there is
# removed first. $NODE_DIR/bin/node must exist (check it up front).

# True when the foundry user can write in directory $1 (read-only check, for the up-front refusals).
foundry_can_write() {
  runuser -u "$FOUNDRY_USER" -- test -w "$1"
}

# foundry_edit_json FILE JS [ARG...]: edits the JSON file as the foundry user. JS is the body of a function of
# (o, a): o is the parsed object (change it in place), a the ARGs. Example:
#   foundry_edit_json "$options" 'o.world = a[0] || null' "$world"
foundry_edit_json() {
  local file="$1" body="$2"
  shift 2
  runuser -u "$FOUNDRY_USER" -- "$NODE_DIR/bin/node" -e 'const fs=require("fs");const [p,body,...a]=process.argv.slice(1);const st=fs.statSync(p);const o=JSON.parse(fs.readFileSync(p,"utf8"));new Function("o","a",body)(o,a);const t=p+".foundry-tmp";fs.rmSync(t,{force:true});fs.writeFileSync(t,JSON.stringify(o,null,2)+"\n",{mode:st.mode&0o777});fs.chmodSync(t,st.mode&0o777);fs.renameSync(t,p)' "$file" "$body" "$@"
}

# foundry_copy_file SRC DST: copies a file as the foundry user (cp -a, so mode and times are kept), through a temp
# file and a rename. Used for the saved copy of options.json and for putting it back.
foundry_copy_file() {
  runuser -u "$FOUNDRY_USER" -- sh -c 't="$2.foundry-tmp"; rm -f "$t" && cp -a "$1" "$t" && mv -f "$t" "$2"' sh "$1" "$2"
}

# control_port_check [PORT]: the bridge's control port (default 31414), which the Cloudflare TCP route
# (D-095, mcp.<domain>) points at. It has no login of its own, so it must listen on loopback only.
# Returns 0 = answers a ping on loopback and nothing listens beyond loopback, 1 = no ping answer,
# 2 = a listener beyond loopback (checked first). Read-only.
control_port_check() {
  local port="${1:-31414}" listeners reply=""
  listeners="$(ss -ltnH "sport = :$port" 2>/dev/null | awk '{print $4}' || true)"
  if [ -n "$listeners" ] && printf '%s\n' "$listeners" | grep -qvE '^(127\.0\.0\.1|\[::1\]):'; then
    return 2
  fi
  reply="$( { exec 3<>"/dev/tcp/127.0.0.1/$port"; printf '{"id":"ping","method":"ping"}\n' >&3; IFS= read -r -t 5 -u 3 line; printf '%s' "${line:-}"; } 2>/dev/null )" || true
  case "$reply" in *'"ok":true'*) return 0 ;; esac
  return 1
}
