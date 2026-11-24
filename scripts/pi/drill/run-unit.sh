#!/usr/bin/env bash
# Rebuild drill helper (docs/dev/PI-SETUP.md, "Rebuild drill"): runs a systemd service by hand,
# for a container that has no systemd. It reads the unit file the stage script wrote and starts
# the same command as the same user with the same environment (Environment=, EnvironmentFile=,
# WorkingDirectory=, ExecStart=), in the background, logging to /drill/<unit>.out.
# Usage: run-unit.sh foundry-ai-tool-bridge   (the unit name without .service)
# Never prints environment values: the env files hold secrets.
set -euo pipefail

unit="${1:?usage: run-unit.sh <unit name without .service>}"
file="/etc/systemd/system/$unit.service"
[ -f "$file" ] || {
  echo "no $file" >&2
  exit 1
}

user="$(sed -n 's/^User=//p' "$file" | head -n1)"
workdir="$(sed -n 's/^WorkingDirectory=//p' "$file" | head -n1)"
exec_start="$(sed -n 's/^ExecStart=//p' "$file" | head -n1)"
[ -n "$user" ] && [ -n "$exec_start" ] || {
  echo "$file has no User= or ExecStart=" >&2
  exit 1
}

# systemd sets HOME to the user's home for User=; the unit's own Environment= may override it.
env_args=("HOME=$(getent passwd "$user" | cut -d: -f6)")
# Like systemd: the unit file first, then its drop-ins (<unit>.service.d/*.conf) in name order. Stages 21, 27, 30 and 32
# write drop-ins with Environment= and EnvironmentFile= lines, so a service started here gets what a rebuilt Pi gives it.
env_files=("$file")
for d in "/etc/systemd/system/$unit.service.d/"*.conf; do
  [ -f "$d" ] && env_files+=("$d")
done
while IFS= read -r line; do
  env_args+=("$line")
done < <(sed -n 's/^Environment=//p' "${env_files[@]}")
# EnvironmentFile=-path (the dash: the file may be missing). Read as root, pass on as KEY=VALUE.
while IFS= read -r ef; do
  ef="${ef#-}"
  [ -f "$ef" ] || continue
  while IFS= read -r line; do
    case "$line" in '' | '#'*) continue ;; esac
    line="${line%\"}"
    line="${line/=\"/=}"
    env_args+=("$line")
  done <"$ef"
done < <(sed -n 's/^EnvironmentFile=//p' "${env_files[@]}")

mkdir -p /drill
cd "${workdir:-/}"
# shellcheck disable=SC2086
runuser -u "$user" -- env "${env_args[@]}" nohup $exec_start >"/drill/$unit.out" 2>&1 </dev/null &
echo "started $unit as $user (pid $!), log /drill/$unit.out"
