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

say "checking before anything is written"
command -v curl >/dev/null 2>&1 || die "curl is missing"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is missing"
command -v pgrep >/dev/null 2>&1 || die "pgrep (procps) is missing: the gate uses it to leave a running job alone"
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing at $NODE_DIR: run stage 2 first"
[ -d "$TOOL_ETC" ] || die "$TOOL_ETC is missing: run stage 1 first"

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
  if [ ! -x "$dir/bin/Runner.Listener" ]; then
    runuser -u "$RUNNER_USER" -- tar -xzf "$tarball" -C "$dir"
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
    ACTIONS_RUNNER_INPUT_TOKEN="$(cat "$reg")" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 HOME="$dir/home" \
      runuser -u "$RUNNER_USER" -- "$dir/config.sh" --unattended \
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
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      if (nowMs - fs.statSync(full).mtimeMs > 2 * MAX) continue;
      let last = null;
      for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e.eventType !== "session-start" && e.eventType !== "session-end") continue;
          const ms = e.timestampMs ?? Date.parse(e.timestamp ?? "");
          if (!Number.isNaN(ms)) last = { type: e.eventType, ms };
        } catch {}
      }
      if (last && last.type === "session-start" && nowMs - last.ms <= MAX) playing = true;
    } catch { unknown = true; }
  }
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

for unit in $units; do
  name="${unit#foundry-ai-tool-gh-runner-}"
  name="${name%.service}"
  if [ "$decision" = idle ]; then
    systemctl is-active --quiet "$unit" || {
      systemctl start "$unit"
      echo "gh-runner-gate: $decision: started $unit"
    }
  else
    if systemctl is-active --quiet "$unit"; then
      if pgrep -f "/opt/gh-runner/$name/bin/Runner.Worker" >/dev/null 2>&1; then
        echo "gh-runner-gate: $state: $unit runs a job, left alone"
      else
        systemctl stop "$unit"
        echo "gh-runner-gate: $state: stopped $unit"
      fi
    fi
  fi
done
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
IPAddressDeny=127.0.0.0/8 ::1/128 100.64.0.0/10 fd7a:115c:a1e0::/48
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
enable_unit foundry-ai-tool-gh-runner-gate.timer

if have_systemd; then
  say "one gate run now"
  "$GATE_SCRIPT" </dev/null || warn "the first gate run failed: journalctl -u foundry-ai-tool-gh-runner-gate -n 20"
  sleep 3
  for pair in $RUNNERS; do
    systemctl is-active "foundry-ai-tool-gh-runner-${pair%%:*}.service" </dev/null || true
  done
  GATE_DRY=1 "$GATE_SCRIPT" </dev/null || true
else
  warn "no systemd here (a test container?): units written, not started"
fi

say "stage 17 done: runners vault and board, gate every minute. Check on GitHub: Settings > Actions > Runners of each repo shows foundry-pi"
