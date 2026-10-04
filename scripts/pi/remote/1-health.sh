#!/usr/bin/env bash
# Stage 1: health check, updates, the foundry user and the folders (PI-SETUP.md, Part B).
# Run from the PC:  ssh foundry-pi 'bash -s' < scripts/pi/remote/lib.sh scripts/pi/remote/1-health.sh
# (Claude concatenates lib.sh and the stage into one stream.)

require_root
require_arm64

say "system"
. /etc/os-release
ok "${PRETTY_NAME:-unknown OS}, kernel $(uname -r)"
case "${VERSION_ID:-}" in
  13) ok "Debian 13" ;;
  *) warn "expected Debian 13 (Trixie), got ${VERSION_ID:-unknown}" ;;
esac

say "updates"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get -y -qq upgrade >/dev/null
ok "packages up to date"
apt_install ca-certificates curl xz-utils unzip

say "disk, memory, temperature, clock"
df -h / | awk 'NR==2 { printf "    root filesystem: %s used of %s (%s free)\n", $3, $2, $4 }'
awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 }
  END { printf "    memory: %.1f GB total, %.1f GB available\n", t / 1048576, a / 1048576 }' /proc/meminfo
for zone in /sys/class/thermal/thermal_zone*/temp; do
  [ -r "$zone" ] || continue
  awk -v z="$zone" '{ printf "    %s: %.1f C\n", z, $1 / 1000 }' "$zone"
  break
done
ok "time zone $(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo unknown), now $(date '+%Y-%m-%d %H:%M %Z')"
if have_systemd && timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
  ok "clock synchronised"
elif have_systemd; then
  warn "clock not synchronised yet (it usually is within minutes of the first boot)"
fi

say "the foundry user and folders"
if id "$FOUNDRY_USER" >/dev/null 2>&1; then
  ok "user $FOUNDRY_USER exists"
else
  useradd --system --home-dir "$FOUNDRY_DATA" --shell /usr/sbin/nologin "$FOUNDRY_USER"
  ok "created system user $FOUNDRY_USER"
fi
install -d -m 0755 "$FOUNDRY_APP" "$NODE_DIR" "$TOOL_DIR"
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$FOUNDRY_DATA" "$TOOL_DATA"
install -d -m 0750 -o root -g "$FOUNDRY_USER" "$TOOL_ETC"
# The recorder bot's recordings (stage 8; group-writable, new files keep the group).
install -d -m 2770 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA/recordings"
ok "$FOUNDRY_APP $NODE_DIR $TOOL_DIR (root), $FOUNDRY_DATA $TOOL_DATA ($FOUNDRY_USER), $TOOL_ETC (root, group $FOUNDRY_USER)"

say "stage 1 done"
