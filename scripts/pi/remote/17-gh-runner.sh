#!/usr/bin/env bash
# Stage 17: GitHub Actions self-hosted runners on the Pi for the PM board (backlog board-local-deploy). The board is rebuilt
# by GitHub Actions on every vault push and used up the free hosted minutes (2026-10-28); the Pi runs the jobs instead.
# Two repo-level runners (a repo runner serves one repo): `vault` for Gnuminator/obsidian-vault (workflow `board`) and
# `board` for Gnuminator/foundry-ai-tool-pm-board (workflow `deploy board`). Run from the PC:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/17-gh-runner.sh | ssh foundry-pi 'bash -s'
#
# Before it runs (the first time, and whenever a runner must be registered again), for each runner the PC puts a
# registration token on the Pi without printing it: scripts/pi/remote/put-runner-token.sh vault|board. The token lives one
# hour, sits in $TOOL_ETC/gh-runner-<name>.reg (root only, 0600), and this stage deletes it after registering. A runner that
# is already registered (its .runner file) needs no token. The Cloudflare token stays where the workflow already reads it:
# the `board` environment secrets on GitHub; nothing of it is stored on the Pi.
#
# What it makes: the user `ghrunner` (no login, no sudo, no group of the foundry user); /opt/gh-runner/<name>/ (the pinned
# runner release, sha256 checked); one hardened systemd unit per runner (no write outside its folder, the loopback and
# Tailscale addresses unreachable, so a job cannot talk to the bridge, the dashboard or the Tailscale ports, 2 GB, low CPU weight);
# and a gate timer (every minute) that keeps the runners STOPPED while a play session is marked (the same signal the Cast worker
# uses: the newest session-start/session-end marker in the world vaults' sessions/<date>.jsonl). A job waits on GitHub's
# side while the runners are stopped. A job already running is never killed by the gate. Unknown state (the vault folder
# cannot be read) counts as playing, up to GATE_UNKNOWN_CEILING_HOURS in a row, then the gate lets the runners run again
# and logs it (a broken signal must not freeze the board for good). The runners are not enabled at boot: the gate starts them.

require_root
require_arm64
require_recent_snapshot

RUNNER_VERSION=2.338.2
RUNNER_SHA256=670adb2f268fe21dcbb58b3db0e0aa9d5b3bddfe2c651481336e561ff86de945
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz"
GH_OWNER=Gnuminator
RUNNER_USER=ghrunner
RUNNER_BASE=/opt/gh-runner
# name:repo
RUNNERS="vault:obsidian-vault board:foundry-ai-tool-pm-board"
GATE_SCRIPT="$RUNNER_BASE/gate.sh"
# Addresses a job must not reach: loopback (bridge, dashboard, Foundry link), Tailscale, and the whole LAN except the router
# (DNS and the way out; the Pi's own LAN address is in the denied range, so Foundry on it is out too).
IP_DENY="127.0.0.0/8 ::1/128 100.64.0.0/10 fd7a:115c:a1e0::/48 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 fe80::/10"
ROUTER="$(ip -4 route show default 2>/dev/null | awk '/default/ {print $3; exit}')"

say "checking before anything is written"
command -v curl >/dev/null 2>&1 || die "curl is missing"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is missing"
command -v pgrep >/dev/null 2>&1 || die "pgrep (procps) is missing: the gate uses it to leave a running job alone"
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing at $NODE_DIR: run stage 2 first"
[ -d "$TOOL_ETC" ] || die "$TOOL_ETC is missing: run stage 1 first"
if have_systemd; then
  [ -n "$ROUTER" ] || die "no default route (ip -4 route): the units need the router address for DNS"
  command -v systemd-run >/dev/null 2>&1 || die "systemd-run is missing (the fence probe needs it)"
fi

# A runner without .runner needs its registration token file, checked now so a missing one stops the stage before it writes.
for pair in $RUNNERS; do
  name="${pair%%:*}"
  reg="$TOOL_ETC/gh-runner-$name.reg"
  if [ -f "$RUNNER_BASE/$name/.runner" ]; then
    ok "runner $name is registered already"
    continue
  fi
  if [ -L "$reg" ] || [ ! -f "$reg" ]; then
    die "runner $name is not registered and $reg is missing. From the PC run: scripts/pi/remote/put-runner-token.sh $name (then this stage again within the hour)"
  fi
  [ "$(stat -c '%u %a' "$reg")" = "0 600" ] || die "$reg must be owned by root with mode 0600"
  LC_ALL=C grep -aqE '^[A-Za-z0-9]{20,64}$' "$reg" || die "$reg does not hold a registration token (content not shown)"
  ok "$reg is present, root-only (not printed)"
done

say "the runner user"
if ! getent passwd "$RUNNER_USER" >/dev/null; then
  useradd --system --user-group --home-dir "$RUNNER_BASE" --no-create-home --shell /usr/sbin/nologin "$RUNNER_USER"
  ok "created $RUNNER_USER"
else
  ok "$RUNNER_USER exists"
fi
case "$(id -nG "$RUNNER_USER")" in
*"$FOUNDRY_USER"* | *sudo* | *adm*) die "$RUNNER_USER is in a group that gives it more than it needs: $(id -nG "$RUNNER_USER")" ;;
esac
install -d -m 0755 -o root -g root "$RUNNER_BASE" "$RUNNER_BASE/cache"

say "the pinned runner release $RUNNER_VERSION"
tarball="$RUNNER_BASE/cache/actions-runner-linux-arm64-$RUNNER_VERSION.tar.gz"
if [ -f "$tarball" ] && [ "$(sha256sum "$tarball" | cut -d' ' -f1)" = "$RUNNER_SHA256" ]; then
  ok "tarball cached"
else
  rm -f "${tarball:?}"
  curl -fsSL --proto '=https' --max-time 300 -o "$tarball" "$RUNNER_URL"
  [ "$(sha256sum "$tarball" | cut -d' ' -f1)" = "$RUNNER_SHA256" ] || {
    rm -f "${tarball:?}"
    die "the downloaded runner does not match the pinned sha256: nothing installed"
  }
  ok "downloaded, sha256 matches"
fi

# The runner updates its own files (as $RUNNER_USER, inside its folder); the pin is the first install.
for pair in $RUNNERS; do
  name="${pair%%:*}"
  repo="${pair#*:}"
  dir="$RUNNER_BASE/$name"
  say "runner $name ($GH_OWNER/$repo)"
  install -d -m 0750 -o "$RUNNER_USER" -g "$RUNNER_USER" "$dir"
  # Extracted as the runner user, never as root: a link left in its folder cannot make root write elsewhere.
  # The marker is written after tar succeeded, so an interrupted extraction is done again on the next run.
  if [ ! -f "$dir/.extracted" ]; then
    runuser -u "$RUNNER_USER" -- tar -xzf "$tarball" -C "$dir"
    runuser -u "$RUNNER_USER" -- sh -c 'printf "%s\n" "$1" > "$2"' sh "$RUNNER_VERSION" "$dir/.extracted"
    ok "extracted into $dir"
  else
    ok "runner files already there (not replaced: the runner updates itself)"
  fi
  runuser -u "$RUNNER_USER" -- mkdir -p "$dir/home" "$dir/_work"
  if [ ! -f "$dir/.runner" ]; then
    reg="$TOOL_ETC/gh-runner-$name.reg"
    # The token goes in through the environment of this one process (config.sh reads ACTIONS_RUNNER_INPUT_TOKEN), never
    # on a command line, and the file is gone whatever happens next.
    trap 'rm -f "${reg:?}"' EXIT
    # runuser keeps the environment but env sets HOME for the runner user (runuser may reset it to the passwd home).
    ACTIONS_RUNNER_INPUT_TOKEN="$(cat "$reg")" \
      runuser -u "$RUNNER_USER" -- env DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 HOME="$dir/home" "$dir/config.sh" --unattended \
      --url "https://github.com/$GH_OWNER/$repo" --name foundry-pi --labels pi --work "$dir/_work" --replace >/dev/null ||
      die "registering runner $name failed (the token may be older than an hour: run put-runner-token.sh $name again)"
    rm -f "${reg:?}"
    trap - EXIT
    [ -f "$dir/.runner" ] || die "runner $name did not register ($dir/.runner is missing)"
    ok "registered; the token file is deleted"
  fi
done

say "the gate (stops the runners while a play session is marked)"
# Quoted heredoc: nothing in it is expanded here; it runs every minute from a timer. Environment, for tests only:
# GATE_VAULT_ROOT, GATE_UNITS, GATE_STATE_DIR, GATE_NODE, GATE_NOW_MS, GATE_DRY=1 (print the decision, change nothing).
script_body="$(
  cat <<'GATE_SCRIPT_BODY'
#!/usr/bin/env bash
# Keeps the GitHub runners off the Pi while a play session is marked (written by scripts/pi/remote/17-gh-runner.sh; edit it there).
# Idle: start the runners that are stopped. Playing, or unknown: stop the runners that run no job.
set -euo pipefail
vault_root="${GATE_VAULT_ROOT:-/var/lib/foundry-ai-tool/vault}"
units="${GATE_UNITS:-foundry-ai-tool-gh-runner-vault.service foundry-ai-tool-gh-runner-board.service}"
state_dir="${GATE_STATE_DIR:-/run/foundry-gh-runner-gate}"
node="${GATE_NODE:-/opt/node24/bin/node}"
now_ms="${GATE_NOW_MS:-$(($(date +%s) * 1000))}"
ceiling_hours="${GATE_UNKNOWN_CEILING_HOURS:-6}"
cgroup_root="${GATE_CGROUP_ROOT:-/sys/fs/cgroup}"
proc_root="${GATE_PROC_ROOT:-/proc}"
mkdir -p "$state_dir"

# playing | idle | unknown. Per world the newest 3 session logs decide (the last marker wins; a start older than 14 hours
# is stale); a log untouched for 28 hours is skipped. Any world playing means playing.
state="$(
  "$node" -e '
const fs = require("fs"), path = require("path");
const [root, nowMs] = [process.argv[1], Number(process.argv[2])];
const H = 3600000, MAX = 14 * H;
let worlds;
try { worlds = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
catch { console.log("unknown"); process.exit(0); }
let playing = false, unknown = false;
for (const w of worlds) {
  const dir = path.join(root, w, "sessions");
  let files;
  try { files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse().slice(0, 3); }
  catch (e) { if (e && e.code === "ENOENT") continue; unknown = true; continue; }
  // Markers are filed by the local date they were written on, so a session that crosses midnight has its start in one
  // file and its end in the next: the newest marker over all the files decides, not each file on its own.
  let last = null;
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      if (nowMs - fs.statSync(full).mtimeMs > 2 * MAX) continue;
      for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.eventType !== "session-start" && e.eventType !== "session-end") continue;
          const ms = e.timestampMs ?? Date.parse(e.timestamp ?? "");
          if (!Number.isNaN(ms) && (!last || ms >= last.ms)) last = { type: e.eventType, ms };
        } catch {}
      }
    } catch { unknown = true; }
  }
  if (last && last.type === "session-start" && nowMs - last.ms <= MAX) playing = true;
}
console.log(playing ? "playing" : unknown ? "unknown" : "idle");
' "$vault_root" "$now_ms" 2>/dev/null
)" || state=unknown
case "$state" in playing | idle | unknown) ;; *) state=unknown ;; esac

# Unknown holds the runners, but only for a ceiling in a row.
since_file="$state_dir/unknown-since-ms"
decision="$state"
if [ "$state" = unknown ]; then
  [ -f "$since_file" ] || printf '%s' "$now_ms" >"$since_file"
  since="$(cat "$since_file" 2>/dev/null || true)"
  case "$since" in '' | *[!0-9]*) since="$now_ms" ;; esac
  if [ $((now_ms - since)) -gt $((ceiling_hours * 3600000)) ]; then
    decision=idle
    echo "gh-runner-gate: the play-session state has been unknown for over $ceiling_hours hours: letting the runners run" >&2
  fi
else
  rm -f "$since_file"
fi

if [ "${GATE_DRY:-0}" = 1 ]; then
  echo "state=$state decision=$decision"
  exit 0
fi

# True when the unit's cgroup holds a Runner.Worker process (a job). Found through the unit, not a path: the runner updates
# itself into a versioned bin folder, so the path of the worker changes.
has_job() {
  local cg pid
  cg="$(systemctl show -p ControlGroup --value "$1" 2>/dev/null || true)"
  [ -n "$cg" ] && [ -r "$cgroup_root$cg/cgroup.procs" ] || return 1
  for pid in $(cat "$cgroup_root$cg/cgroup.procs" 2>/dev/null); do
    [ "$(cat "$proc_root/$pid/comm" 2>/dev/null || true)" = Runner.Worker ] && return 0
  done
  return 1
}

rc=0
for unit in $units; do
  # activating (a runner waiting out its restart delay) counts as running; only inactive and failed are stopped
  st="$(systemctl is-active "$unit" 2>/dev/null || true)"
  if [ "$decision" = idle ]; then
    case "$st" in
    active | activating) ;;
    *)
      if systemctl start "$unit"; then echo "gh-runner-gate: $decision: started $unit"; else
        echo "gh-runner-gate: could not start $unit" >&2
        rc=1
      fi
      ;;
    esac
  else
    case "$st" in
    inactive | failed | "") ;;
    *)
      if has_job "$unit"; then
        echo "gh-runner-gate: $state: $unit runs a job, left alone"
      elif systemctl stop "$unit"; then
        echo "gh-runner-gate: $state: stopped $unit"
      else
        echo "gh-runner-gate: could not stop $unit" >&2
        rc=1
      fi
      ;;
    esac
  fi
done
exit $rc
GATE_SCRIPT_BODY
)"
write_file "$GATE_SCRIPT" 0755 "$script_body" || true
chown root:root "$GATE_SCRIPT"
chmod 0755 "$GATE_SCRIPT"

say "the units"
for pair in $RUNNERS; do
  name="${pair%%:*}"
  repo="${pair#*:}"
  dir="$RUNNER_BASE/$name"
  other=""
  for p2 in $RUNNERS; do
    [ "${p2%%:*}" = "$name" ] || other="$other $RUNNER_BASE/${p2%%:*}"
  done
  unit_body="[Unit]
Description=GitHub Actions runner for $GH_OWNER/$repo (PM board; stopped by the gate during a play session)
Wants=network-online.target
After=network-online.target time-sync.target

[Service]
User=$RUNNER_USER
WorkingDirectory=$dir
Environment=HOME=$dir/home
Environment=DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
ExecStart=$dir/run.sh
Restart=always
RestartSec=20
KillSignal=SIGINT
TimeoutStopSec=60
# A job must not touch the live game: no write outside the runner's own folder, no way to the bridge (31414/31415), the
# dashboard (3000) or the Tailscale ports, none of Foundry's, the tool's or the backups' folders, and little CPU and memory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$dir
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
InaccessiblePaths=-/etc/foundry-ai-tool -/var/lib/foundry -/var/lib/foundry-ai-tool -/var/lib/foundry-backup -/mnt -/root$other
ProtectProc=invisible
IPAddressDeny=$IP_DENY
IPAddressAllow=$ROUTER/32
Nice=10
CPUWeight=20
MemoryMax=2G
TasksMax=512
# No [Install]: the gate timer starts the runner when no play session is marked."
  write_file "/etc/systemd/system/foundry-ai-tool-gh-runner-$name.service" 0644 "$unit_body" || true
done

gate_service="[Unit]
Description=Foundry AI Tool: keep the GitHub runners off the Pi during a play session

[Service]
Type=oneshot
ExecStart=$GATE_SCRIPT
Nice=10
TimeoutStartSec=120"
gate_timer="[Unit]
Description=Foundry AI Tool: GitHub runner gate, every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target"
write_file /etc/systemd/system/foundry-ai-tool-gh-runner-gate.service 0644 "$gate_service" || true
write_file /etc/systemd/system/foundry-ai-tool-gh-runner-gate.timer 0644 "$gate_timer" || true

if have_systemd; then
  # The fence is proved before any runner starts: a service with the units' address rules must NOT reach sshd, which
  # listens on every address, on loopback and on the Pi's own LAN address. A kernel without cgroup BPF firewalling would
  # start the unit "WITHOUT firewalling" and the connect would succeed: then nothing is started.
  say "the fence (a probe with the units' address rules must be refused)"
  [ -n "$ROUTER" ] || die "no default route: cannot tell the router address for the units"
  lan_ip="$(hostname -I | tr ' ' '\n' | grep -E '^(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.' | head -n 1 || true)"
  for target in 127.0.0.1 $lan_ip; do
    if systemd-run --quiet --wait --collect --pipe -p "User=$RUNNER_USER" -p "IPAddressDeny=$IP_DENY" -p "IPAddressAllow=$ROUTER/32" \
      /bin/bash -c "exec 3<>/dev/tcp/$target/22" </dev/null >/dev/null 2>&1; then
      die "a service with the runner's address rules still reached $target:22: the kernel does not enforce IPAddressDeny. Nothing was started; the timer is not enabled"
    fi
    ok "$target:22 is refused for the runner's rules"
  done
  enable_unit foundry-ai-tool-gh-runner-gate.timer
  say "one gate run now"
  "$GATE_SCRIPT" </dev/null || warn "the first gate run failed: journalctl -u foundry-ai-tool-gh-runner-gate -n 20"
  sleep 3
  GATE_DRY=1 "$GATE_SCRIPT" </dev/null || true
  for pair in $RUNNERS; do
    unit="foundry-ai-tool-gh-runner-${pair%%:*}.service"
    if ! systemctl is-active --quiet "$unit"; then
      ok "$unit is stopped (a play session is marked, or the state is unknown)"
      continue
    fi
    online=""
    for _ in $(seq 1 30); do
      if [ "$(journalctl -u "$unit" -b --no-pager -o cat 2>/dev/null | grep -c 'Listening for Jobs' || true)" -gt 0 ]; then
        online=1
        break
      fi
      sleep 2
    done
    [ -n "$online" ] && ok "$unit is online (Listening for Jobs)" || warn "$unit never said 'Listening for Jobs': journalctl -u $unit -n 30"
  done
else
  warn "no systemd here (a test container?): units written, not started"
fi

say "stage 17 done: runners vault and board, gate every minute. Check on GitHub: Settings > Actions > Runners of each repo shows foundry-pi"
