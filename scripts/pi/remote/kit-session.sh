#!/usr/bin/env bash
# Kit session: a throwaway test run of level-1 character creation, as a player, in the Pi's test world strahd-kit
# (never curse-of-strahd), and then everything put back (docs/dev/PI-SETUP.md, "Kit session"). Modelled on stage 13.
# The test kit also gets a GM there: the user "Kit GM" (made for the session, with a password made for the run) whose
# headless browser holds the module's bridge link, so the kit can run tools against strahd-kit.
#   scp scripts/pi/remote/kit-session.mjs foundry-pi:/root/ && cat scripts/pi/remote/lib.sh scripts/pi/remote/kit-session.sh | ssh foundry-pi 'MODE=up bash -s'
# ...the player makes a character at http://foundry-pi:30000/join as "Kit Player", then:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/kit-session.sh | ssh foundry-pi 'MODE=down bash -s'
# The scp copies the in-browser part (the stage installs it into /opt/foundry-ai-tool/gm-browser/ and removes the
# upload, the same way stage 13 handles player-creation-settings.mjs). Environment variables go in front of bash.
# Take a snapshot first (dietpi-backup 1) and get the user's OK: this stops Foundry for a few minutes.
# Env: MODE (required: up or down; anything else stops before anything changes), FORCE (1 goes on even when people
#   are online or /api/status cannot be read; default 0 refuses), SESSION_DRIVER (the uploaded .mjs, default
#   /root/kit-session.mjs), MAX_DELETE (down only: more than 5 actors owned by Kit Player are refused; this raises
#   the limit). The world (strahd-kit) and the player (Kit Player) are fixed in this script and in the driver.
# What MODE=up does:
#   Before anything stops: the world, its GM login (/etc/foundry-ai-tool/world-strahd-kit.env, never printed), the
#   tool's build, the Assistant GM driver (stage 5: /opt/foundry-ai-tool/gm-browser/assistant-gm.mjs) and the bridge
#   service must be there, no kit session may be up already (the state file below), Foundry must not launch
#   strahd-kit already, and space is checked (20% free warns, under 5% stops). The Kit GM browser unit is stopped
#   (harmless when it does not exist), and a leftover Kit GM password file, temp file, browser profile or Kit GM
#   browser unit that is not inactive (running, restarting, failed) without a state file (an earlier run that was
#   cut off) is removed, and what was removed is printed: nothing else uses those names. Then the Assistant GM browser stops, /api/status must
#   answer and count no one online (FORCE=1 overrides), and Foundry stops. The state file
#   /var/lib/foundry-ai-tool/kit-session.env (ORIG_WORLD, WAS_GM_BROWSER, STAMP, KIT_GM_BROWSER=1; mode 600) is
#   written before options.json changes (through a temp file in /etc/foundry-ai-tool and a rename, so root never
#   writes through a path the foundry user owns); once the setup has verified, ORIG_BRIDGE_USER=<id or empty>, the
#   bridge user the setup replaced, is added to it. strahd-kit's settings, users and actors are copied to
#   /var/lib/foundry-import/prev-<stamp>/worlds/strahd-kit/ (never deleted). options.json launches strahd-kit and
#   Foundry starts. The password of the Kit GM is made here, with 16 random bytes as 32 hex characters, and written
#   to /etc/foundry-ai-tool/kit-gm.env (one line ASSISTANT_GM_PASSWORD=<hex>, root:root, mode 600, through a mktemp
#   file in that folder and a rename; /etc/foundry-ai-tool is root's, unlike /var/lib/foundry-ai-tool, which the
#   foundry user owns) before the driver runs; it is never printed, and never on a command line, and the stage's
#   passwords stay out of an accidental `bash -x` trace. A headless Chromium
#   joins as the world's GM and runs kit-session.mjs ACTION=setup (the password goes to it in the environment): the
#   settings character creation needs, the passwordless player user "Kit Player", the bridge module enabled when it is
#   not, and the GM user "Kit GM" as the module's bridge user. Then the Kit GM browser starts as the transient unit
#   foundry-ai-tool-kit-gm-browser (systemd-run, with the hardening and priority properties of the Assistant GM
#   unit, not its After=/Wants= ordering; a reboot drops it and nothing starts it again), in a fresh profile folder
#   /var/lib/foundry-ai-tool/kit-gm-browser made by the foundry user, and the stage waits
#   for "joined world strahd-kit as Kit GM" in its journal and looks for the bridge link on port 31415 (a warning
#   only). Foundry stays running on strahd-kit and the Assistant GM browser stays stopped (it would join strahd-kit
#   and move the bridge link, and so the Claude Desktop connectors, to the test world; the Kit GM holds the link
#   instead). The PC reads the password with a file read over ssh; it is not printed here. If anything fails after
#   the services stopped, the Kit GM browser, its password file and profile are removed, options.json, Foundry and
#   the Assistant GM browser are put back as they were and the state file is removed, even when the ssh session drops.
# What MODE=down does:
#   Needs the state file, strahd-kit running, and nobody online (the Kit Player must have left the game; FORCE=1
#   overrides). The Kit GM browser (when the state file says there is one) and the Assistant GM browser are stopped
#   first (a reboot during the session starts the Assistant GM browser on strahd-kit; the Kit GM browser would count
#   as online). It runs kit-session.mjs ACTION=teardown while strahd-kit still runs: the actors Kit Player owns (at
#   most 5) and the user are deleted, the bridge user goes back to "Any GM" when it is the Kit GM, and the user Kit GM
#   is deleted, nothing else. The bridge user goes back to the one the state file names (ORIG_BRIDGE_USER) when
#   that user still exists and is a GM, else to "Any GM"; a state file without that line means "Any GM". If that
#   fails, nothing else changes (the state file and the Kit GM password file stay,
#   Foundry stays on strahd-kit, the Kit GM browser stays stopped) so the stage can run again. Otherwise the Kit GM
#   password file and the browser profile are removed, Foundry stops, options.json launches ORIG_WORLD again, the
#   state file is removed, Foundry starts, and the Assistant GM browser starts again if it ran before (the stage waits
#   for "joined world"). A state file from before the Kit GM existed (no KIT_GM_BROWSER line) is accepted: there is no
#   Kit GM file and no browser then, and the teardown finds no Kit GM.

require_root
require_arm64

MODE="${MODE:-}"
case "$MODE" in up | down) ;; *) die "usage: MODE=up (set up the kit session) or MODE=down (take it down), got '$MODE'. Nothing was changed" ;; esac

# Fixed on purpose: no environment variable can point this stage at another world or another player.
KIT_WORLD=strahd-kit
PLAYER_NAME='Kit Player'
KIT_GM_USER='Kit GM'
KIT_GM_UNIT=foundry-ai-tool-kit-gm-browser
FORCE="${FORCE:-0}"
SESSION_DRIVER="${SESSION_DRIVER:-/root/kit-session.mjs}"
MAX_DELETE="${MAX_DELETE:-}"
have_orig_bridge=0 # down: the state file names the bridge user to put back
orig_bridge=""
IMPORT=/var/lib/foundry-import
STATE="$TOOL_DATA/kit-session.env"
data="$FOUNDRY_DATA/Data"
options="$FOUNDRY_DATA/Config/options.json"
driver_dir="$TOOL_DIR/gm-browser"
driver="$driver_dir/kit-session.mjs"
gm_driver="$driver_dir/assistant-gm.mjs" # stage 5's Assistant GM driver; the Kit GM browser runs it too
# The password file is root's: in /etc/foundry-ai-tool, not in /var/lib/foundry-ai-tool (the foundry user owns that
# folder, and root would follow a link the foundry user put there). Root only removes things in $TOOL_DATA (rm does
# not follow links); the profile folder is made by the foundry user.
KIT_GM_ENV="$TOOL_ETC/kit-gm.env"
KIT_GM_PROFILE="$TOOL_DATA/kit-gm-browser"
envf="$TOOL_ETC/world-$KIT_WORLD.env"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"

say "checking the request ($MODE)"
case "$SESSION_DRIVER" in /root/*.mjs) ;; *) die "SESSION_DRIVER must be a .mjs file under /root/ (got $SESSION_DRIVER)" ;; esac
case "$SESSION_DRIVER" in */../* | */..) die "SESSION_DRIVER must not hold .." ;; esac
[ -z "$MAX_DELETE" ] || [[ "$MAX_DELETE" =~ ^[1-9][0-9]{0,3}$ ]] || die "MAX_DELETE must be a whole number from 1 (got '$MAX_DELETE')"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "no user $FOUNDRY_USER: run stage 1 first"
[ -f "$options" ] || die "no $options: has Foundry started once (stage 3)?"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first"
have_systemd || die "no systemd here: the kit session needs the real Pi (it starts and stops Foundry)"
[ -d "$TOOL_DATA" ] || die "no $TOOL_DATA: run stage 5 first"

# options.json "world" is what Foundry launches. The kit session changes it; the first value is kept in the state file.
set_world() {
  # Written by the foundry user (foundry_edit_json in lib.sh: temp file + rename, no root write in its folder).
  foundry_edit_json "$options" 'o.world = a[0] || null' "$1"
}
current_world() {
  node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.world||"")' "$options"
}

# The user's storage rule (2026-10-06, stage 10): every job checks its source and its destination for 20%
# free; below 20% it warns and goes on, below 5% it stops. Integer percent, rounded down.
check_space() { # $1 a path on the filesystem, $2 what to call it
  local avail size pct
  read -r avail size < <(df --output=avail,size -B1 "$1" | tail -n1)
  [ "${size:-0}" -gt 0 ] || {
    warn "cannot read the free space of $2"
    return 0
  }
  pct=$((avail * 100 / size))
  if [ "$pct" -lt 5 ]; then
    die "space is critical on $2: $pct% free (under 5%). Free up space and run this stage again"
  elif [ "$pct" -lt 20 ]; then
    warn "space is low on $2: $pct% free (the rule is 20%); going on"
  else
    ok "$2: $pct% free"
  fi
}

# The driver: the upload in /root when there is one, else the copy installed by an earlier run.
driver_available() { [ -f "$SESSION_DRIVER" ] || [ -f "$driver" ]; }
install_driver() {
  if [ -f "$SESSION_DRIVER" ]; then
    install -d -m 755 "$driver_dir"
    install -m 0644 "$SESSION_DRIVER" "$driver"
    rm -f "$SESSION_DRIVER"
    ok "installed $driver"
  else
    ok "already installed (no new copy in $SESSION_DRIVER)"
  fi
}

# /join answers 200 even when no world runs (an error page), so look for the join form's template.
world_up() { curl -fs http://127.0.0.1:30000/join 2>/dev/null | grep -q 'id="join-game"'; }
wait_for_world() { # $1 world id
  local up=0
  for _ in $(seq 1 60); do
    if world_up; then
      up=1
      break
    fi
    sleep 2
  done
  [ "$up" = 1 ] || die "$1 is not running on port 30000 (see: journalctl -u foundry -n 50)"
}

# Nobody may be playing. An answer that cannot be read counts as "?" (unknown), not as nobody; the setup screen
# has no users field and counts as 0. FORCE=1 goes on anyway.
check_nobody_online() { # $1 what the people would lose
  local online=""
  for _ in $(seq 1 10); do
    online="$(curl -fs http://127.0.0.1:30000/api/status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s).users;process.stdout.write(String(Number.isInteger(u)?u:0))}catch{process.stdout.write("?")}})')" || online="?"
    [ "$online" != 0 ] || break
    sleep 2
  done
  if [ "$online" = "?" ]; then
    if [ "$FORCE" = 1 ]; then
      warn "cannot read who is online (/api/status); FORCE=1, going on anyway"
    else
      die "cannot read who is online in Foundry (/api/status on port 30000): check it runs, or FORCE=1 to go on anyway${ONLINE_NOTE:-}"
    fi
  elif [ "$online" != 0 ]; then
    if [ "$FORCE" = 1 ]; then
      warn "$online user(s) still online; FORCE=1, going on anyway"
    else
      die "$online user(s) are online in Foundry: $1 (or FORCE=1 to go on anyway)${ONLINE_NOTE:-}"
    fi
  fi
}

# Foundry runs the world; a headless Chromium joins as the world's GM and does ACTION (setup or teardown).
run_driver() { # $1 setup or teardown
  (
    { set +x; } 2>/dev/null # a bash -x trace must not show the passwords the sourced file and the lines below hold
    set -a
    # shellcheck disable=SC1090
    . "$envf"
    set +a
    [ -n "${GM_USER:-}" ] && [ -n "${GM_PASSWORD:-}" ] || {
      echo "ERROR: $envf has no GM_USER and GM_PASSWORD" >&2
      exit 1
    }
    # The login stays in the environment (exported by the sourced file), never on a command line. runuser
    # resets HOME to the Foundry user's home (the Foundry data folder), so env sets it after the switch.
    export WORLD="$KIT_WORLD"
    if [ "$1" = setup ]; then
      # The Kit GM password for this run: read from the file the stage wrote (and checked), into the environment only.
      { set +x; } 2>/dev/null
      kit_pw_line="$(grep -E '^ASSISTANT_GM_PASSWORD=[0-9a-f]{32}$' "$KIT_GM_ENV")" || {
        echo "ERROR: $KIT_GM_ENV holds no Kit GM password" >&2
        exit 1
      }
      export KIT_GM_PASSWORD="${kit_pw_line#ASSISTANT_GM_PASSWORD=}"
    fi
    # Teardown: the bridge user to put back (only when the state file names one; no variable means "Any GM").
    unset ORIG_BRIDGE_USER
    if [ "$1" = teardown ] && [ "$have_orig_bridge" = 1 ]; then export ORIG_BRIDGE_USER="$orig_bridge"; fi
    if [ "$1" = setup ]; then
      # Everything the driver prints is also kept in $driver_log (root's, no secrets in it) for the line that reports
      # the bridge user it replaced.
      runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" TOOL_APP="$TOOL_DIR/app" \
        FOUNDRY_URL=http://127.0.0.1:30000 CHROMIUM=/usr/bin/chromium \
        ACTION="$1" MAX_DELETE="$MAX_DELETE" \
        node "$driver" 2>&1 | tee -a "$driver_log"
    else
      runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" TOOL_APP="$TOOL_DIR/app" \
        FOUNDRY_URL=http://127.0.0.1:30000 CHROMIUM=/usr/bin/chromium \
        ACTION="$1" MAX_DELETE="$MAX_DELETE" \
        node "$driver"
    fi
  )
}

# The GM login must exist with both fields, without printing either.
env_has_login() {
  (
    { set +x; } 2>/dev/null
    set -a
    # shellcheck disable=SC1090
    . "$envf"
    set +a
    [ -n "${GM_USER:-}" ] && [ -n "${GM_PASSWORD:-}" ]
  )
}

# A value from the state file (a plain KEY=VALUE file; never sourced).
state_value() { # $1 key
  grep -m1 "^$1=" "$STATE" | cut -d= -f2- || true
}

# ---- the Kit GM: password file, profile folder and browser unit ----------------------------------------------------

# The Kit GM browser is a transient unit, so it may not exist at all; reset-failed clears a failed leftover.
stop_kit_gm_browser() {
  systemctl stop "$KIT_GM_UNIT.service" 2>/dev/null || true
  systemctl reset-failed "$KIT_GM_UNIT.service" 2>/dev/null || true
}

# The password file, the temp files the stage makes in /etc/foundry-ai-tool (.kit-gm.*: the password's, the state
# file's, the driver log) and the profile folder go together. Only unlinks: nothing here follows a link.
remove_kit_gm_files() {
  rm -f "${KIT_GM_ENV:?}" "${TOOL_ETC:?}"/.kit-gm.*
  rm -rf "${KIT_GM_PROFILE:?}"
}

# The state file, written through a temp file in /etc/foundry-ai-tool (root's folder; mktemp makes it new, mode 600)
# and a rename, so root never opens a path in the foundry user's folder. $1 "orig" adds ORIG_BRIDGE_USER.
write_kit_state() {
  local t
  t="$(umask 077 && mktemp "$TOOL_ETC/.kit-gm.XXXXXX")"
  {
    printf 'ORIG_WORLD=%s\nWAS_GM_BROWSER=%s\nSTAMP=%s\nKIT_GM_BROWSER=1\n' "$orig_world" "$was_gm_browser" "$stamp"
    if [ "${1:-}" = orig ]; then printf 'ORIG_BRIDGE_USER=%s\n' "$orig_bridge"; fi
  } >"$t"
  chmod 600 "$t"
  mv -f "$t" "$STATE"
}

# One line, 32 hex characters, root only. The password is never printed.
kit_gm_password_ok() {
  [ -f "$KIT_GM_ENV" ] && [ ! -L "$KIT_GM_ENV" ] &&
    [ "$(stat -c '%a %U' "$KIT_GM_ENV")" = "600 root" ] &&
    [ "$(grep -c '' "$KIT_GM_ENV")" = 1 ] &&
    grep -Eqx 'ASSISTANT_GM_PASSWORD=[0-9a-f]{32}' "$KIT_GM_ENV"
}

# Makes the password for this run: 16 random bytes from Node's crypto as 32 hex characters, written under umask 077
# to a mktemp file next to the target (in /etc/foundry-ai-tool, root's) and renamed, so the target is never half
# written and never readable by others. It goes to no command line and to no output.
make_kit_gm_password() {
  local tmp
  tmp="$(umask 077 && mktemp "$TOOL_ETC/.kit-gm.XXXXXX")"
  (umask 077 && node -e 'process.stdout.write("ASSISTANT_GM_PASSWORD=" + require("crypto").randomBytes(16).toString("hex") + "\n")' >"$tmp")
  chown root:root "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$KIT_GM_ENV"
  kit_gm_password_ok || die "$KIT_GM_ENV is not the one-line, mode 600 file it should be"
}

# The Kit GM browser: the Assistant GM driver (stage 5) in a transient unit with the hardening and priority
# properties of the real unit (5-tool.sh; not its After=/Wants=: this stage starts it after Foundry and checked the
# bridge unit), a fresh profile folder and the password file as its environment file (systemd reads it as root, so
# it stays root only). A reboot drops the unit; nothing starts it again. The profile folder is made by the foundry
# user (mkdir does not follow a link that is already there), so root never chowns a path in the foundry user's folder.
start_kit_gm_browser() {
  rm -rf "${KIT_GM_PROFILE:?}"
  runuser -u "$FOUNDRY_USER" -- mkdir -m 700 "$KIT_GM_PROFILE"
  systemctl reset-failed "$KIT_GM_UNIT.service" 2>/dev/null || true
  systemd-run --unit="$KIT_GM_UNIT" --collect --quiet \
    -p User="$FOUNDRY_USER" -p Group="$FOUNDRY_USER" \
    -p NoNewPrivileges=true -p ProtectSystem=full -p PrivateTmp=true -p ReadWritePaths="$TOOL_DATA" \
    -p Nice=10 -p CPUWeight=20 -p Restart=always -p RestartSec=15 \
    -p EnvironmentFile="$KIT_GM_ENV" \
    --setenv=HOME="$TOOL_DATA" --setenv=TOOL_APP="$TOOL_DIR/app" \
    --setenv=FOUNDRY_URL=http://127.0.0.1:30000 --setenv=CHROMIUM=/usr/bin/chromium \
    --setenv=GM_BROWSER_PROFILE="$KIT_GM_PROFILE" --setenv=ASSISTANT_GM_USER="$KIT_GM_USER" \
    "$NODE_DIR/bin/node" "$gm_driver" run
}

# Waits (60 x 2 s) until the Kit GM browser's journal shows it joined strahd-kit as the Kit GM.
wait_kit_gm_joined() { # $1 the time to look from
  local out
  for _ in $(seq 1 60); do
    out="$(journalctl -u "$KIT_GM_UNIT" --since "$1" --no-pager 2>/dev/null)" || out=""
    case "$out" in *"joined world $KIT_WORLD as $KIT_GM_USER"*) return 0 ;; esac
    sleep 2
  done
  return 1
}

# ---- MODE=up ------------------------------------------------------------------------------------------------------
if [ "$MODE" = up ]; then
  # Everything that can say no comes before anything stops or changes.
  [ -f "$data/worlds/$KIT_WORLD/world.json" ] || die "world $KIT_WORLD is not installed ($data/worlds/$KIT_WORLD/world.json): run stage 11 first"
  [ -f "$envf" ] || die "no $envf (the GM login stage 11 writes): run stage 11 first"
  env_has_login || die "$envf has no GM_USER and GM_PASSWORD: run stage 11 first"
  [ -f "$TOOL_DIR/app/package.json" ] || die "the tool is not built at $TOOL_DIR/app: run stage 5 first"
  [ ! -e "$STATE" ] || die "a kit session is already up: run MODE=down first (state: $STATE)"
  orig_world="$(current_world)"
  [ "$orig_world" != "$KIT_WORLD" ] || die "Foundry already launches $KIT_WORLD: nothing to set up (and nothing to put back afterwards). Nothing was changed"
  [[ "$orig_world" =~ ^[a-z0-9-]*$ ]] || die "options.json launches '$orig_world', which is not a plain world id: nothing was changed"
  driver_available || die "no $SESSION_DRIVER: scp scripts/pi/remote/kit-session.mjs foundry-pi:/root/ first"
  # The Kit GM browser runs stage 5's Assistant GM driver under a transient unit and needs the bridge to talk to.
  [ -f "$gm_driver" ] || die "the Assistant GM driver is not installed at $gm_driver (the Kit GM browser runs it): run stage 5 first. Nothing was changed"
  command -v systemd-run >/dev/null 2>&1 || die "no systemd-run here (the Kit GM browser is a transient unit). Nothing was changed"
  systemctl cat foundry-ai-tool-bridge.service >/dev/null 2>&1 || die "the bridge service (foundry-ai-tool-bridge.service) does not exist: run stage 5 first. Nothing was changed"
  install -d -m 700 "$IMPORT"
  prev="$IMPORT/prev-$stamp"
  check_space "$IMPORT" "$IMPORT"
  check_space "$FOUNDRY_DATA" "$FOUNDRY_DATA"

  # No state file is up (checked above), so a Kit GM password file, browser profile or browser unit that is still
  # there was left by a run that was cut off: nothing else uses these names, so it is removed (and said so).
  leftover=()
  for path in "$KIT_GM_ENV" "$TOOL_ETC"/.kit-gm.* "$KIT_GM_PROFILE"; do
    if [ -e "$path" ] || [ -L "$path" ]; then leftover+=("$path"); fi
  done
  # Anything but inactive (or unknown) counts: running, restarting (activating) or failed units are in the way of
  # systemd-run too. The stop is always called (harmless when nothing runs).
  kit_unit_state="$(systemctl is-active "$KIT_GM_UNIT.service" 2>/dev/null || true)"
  case "$kit_unit_state" in inactive | unknown | "") ;; *) leftover+=("the unit $KIT_GM_UNIT ($kit_unit_state)") ;; esac
  stop_kit_gm_browser
  if [ "${#leftover[@]}" -gt 0 ]; then
    remove_kit_gm_files
    warn "removed what an earlier kit session left behind (there is no state file, so none of it is in use): ${leftover[*]}"
  fi

  say "the in-browser part"
  install_driver

  # A failure after the services stopped puts options.json, Foundry and the Assistant GM browser back as they were
  # and removes the state file, so the Pi is never left in a half state.
  stopped=0
  was_foundry=0
  foundry_stopped=0
  was_gm_browser=0
  world_changed=0
  state_written=0
  kit_gm_touched=0
  driver_log=""
  orig_bridge=""
  on_exit() {
    # A dropped ssh session closes our output (SIGPIPE, HUP): the steps below must still all run.
    set +e
    trap '' PIPE HUP
    if [ "$stopped" = 1 ]; then
      if [ "$kit_gm_touched" = 1 ]; then
        # The Kit GM browser first (it would hold the world), then its password file and profile folder.
        stop_kit_gm_browser
        remove_kit_gm_files
      fi
      if [ "$world_changed" = 1 ]; then
        set_world "$orig_world" || true
        warn "options.json restored to launch '${orig_world:-no world}'"
        warn "$PLAYER_NAME and $KIT_GM_USER may exist in $KIT_WORLD: MODE=up and then MODE=down removes them"
      fi
      if [ "$was_foundry" = 1 ] && [ "$foundry_stopped" = 1 ]; then
        systemctl restart foundry.service || true
      elif [ "$was_foundry" = 1 ]; then
        : # never stopped (people were online) or already back on its world: leave it running
      else
        systemctl stop foundry.service 2>/dev/null || true
      fi
      if [ "$was_gm_browser" = 1 ]; then
        systemctl is-active --quiet foundry-ai-tool-gm-browser.service || systemctl start foundry-ai-tool-gm-browser.service || true
      fi
      if [ "$state_written" = 1 ]; then rm -f "${STATE:?}" "${TOOL_ETC:?}"/.kit-gm.*; fi
      warn "the run did not finish: Foundry and the Assistant GM browser are back as they were before it, and there is no kit session"
      if [ -d "$prev" ]; then warn "old copies are in $prev"; fi
    fi
  }
  trap on_exit EXIT

  # Remember what ran, so a failed run starts only that again.
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service && was_gm_browser=1
  say "stopping the Assistant GM browser and Foundry"
  stopped=1
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  # With the Assistant GM browser gone, /api/status counts the people still online.
  if [ "$was_foundry" = 1 ]; then check_nobody_online "run this when nobody plays"; fi
  foundry_stopped=1
  systemctl stop foundry.service

  # The state file first: from here on, MODE=down knows what to put back, and so does a run that fails.
  state_written=1 # before the write: on_exit removes a half written file too
  # KIT_GM_BROWSER=1: this session has a Kit GM (user, password file, profile folder and browser) for MODE=down to remove.
  write_kit_state
  ok "state written to $STATE"

  # Foundry is stopped, so the world's databases can be copied as they are.
  say "copying the settings, users and actors of $KIT_WORLD to $prev"
  install -d -m 700 "$prev" "$prev/worlds" "$prev/worlds/$KIT_WORLD"
  for part in settings users actors; do
    if [ -d "$data/worlds/$KIT_WORLD/data/$part" ]; then
      cp -a "$data/worlds/$KIT_WORLD/data/$part" "$prev/worlds/$KIT_WORLD/$part"
      ok "$part: $prev/worlds/$KIT_WORLD/$part"
    else
      warn "$KIT_WORLD has no data/$part folder to back up"
    fi
  done

  say "starting $KIT_WORLD and setting it up"
  world_changed=1 # before the write: putting the old world back is harmless when nothing was written
  set_world "$KIT_WORLD"
  systemctl start foundry.service
  wait_for_world "$KIT_WORLD"
  ok "$KIT_WORLD is running"

  # The Kit GM's password for this run, before the driver needs it. Root only; it is never printed.
  say "making the password file for $KIT_GM_USER"
  kit_gm_touched=1 # before the write: the rollback removes a half written file too
  make_kit_gm_password
  ok "wrote $KIT_GM_ENV (root only, mode 600; the password is not printed here)"

  driver_log="$(umask 077 && mktemp "$TOOL_ETC/.kit-gm.XXXXXX")" # root's file; removed by the rollback's .kit-gm.* too
  have_orig_bridge=0
  run_driver setup || die "the setup of $KIT_WORLD failed or did not verify (see the lines above)"
  ok "$KIT_WORLD: settings, the player user and the GM user $KIT_GM_USER set and read back"
  # The bridge user the setup replaced (it prints the line only after it verified everything): kept in the state file.
  grep -q '^\[kit-session\] ORIG_BRIDGE_USER=' "$driver_log" || die "the setup did not report the bridge user it replaced (see the lines above)"
  orig_bridge="$(sed -n 's/^\[kit-session\] ORIG_BRIDGE_USER=//p' "$driver_log" | tail -n 1)"
  rm -f "${driver_log:?}"
  [[ "$orig_bridge" =~ ^([A-Za-z0-9]{16})?$ ]] || die "the setup reported a bridge user that is not a user id: nothing is kept (the run is put back)"
  write_kit_state orig
  ok "the bridge user it replaced (${orig_bridge:-Any GM}) is kept in the state file"

  say "starting the Kit GM browser (joins $KIT_WORLD as $KIT_GM_USER and holds the bridge link)"
  kit_since="$(date '+%Y-%m-%d %H:%M:%S')"
  start_kit_gm_browser
  ok "started $KIT_GM_UNIT.service (a transient unit: a reboot drops it)"
  wait_kit_gm_joined "$kit_since" || die "the Kit GM browser did not join $KIT_WORLD as $KIT_GM_USER within 2 minutes (see: journalctl -u $KIT_GM_UNIT -n 30)"
  # Only the "joined world" line is shown, never the rest of the journal.
  journalctl -u "$KIT_GM_UNIT" --since "$kit_since" --no-pager 2>/dev/null | grep -m1 'joined world' || true
  ok "the Kit GM browser joined $KIT_WORLD as $KIT_GM_USER"
  # The bridge does not log connects, so look for the connection itself: an established TCP connection on the
  # bridge's Foundry port 31415 (the Kit GM browser's module, same check as stage 11). A warning only.
  linked=0
  for _ in $(seq 1 10); do
    if [ -n "$(ss -Htn state established '( sport = :31415 )' 2>/dev/null)" ]; then
      linked=1
      break
    fi
    sleep 2
  done
  if [ "$linked" = 1 ]; then
    ok "a Foundry connection is established on the bridge's port 31415"
  else
    warn "no established connection on the bridge's port 31415 yet; see: journalctl -u $KIT_GM_UNIT -n 30 and journalctl -u foundry-ai-tool-bridge -n 30"
  fi

  # Done: Foundry stays on strahd-kit, the Assistant GM browser stays stopped, and nothing is put back by itself.
  stopped=0
  trap - EXIT
  prev_note="old copies kept in $prev ($(du -sh "$prev" | cut -f1)); remove them later, only with the user's OK"

  say "summary"
  echo "    The kit session is up. Foundry runs $KIT_WORLD (it launched ${orig_world:-no world} before)."
  echo "    Join:  http://foundry-pi:30000/join"
  echo "    User:  $PLAYER_NAME (no password)"
  echo "    GM for the test kit: $KIT_GM_USER (Game Master, the module's bridge user); its browser ($KIT_GM_UNIT) holds the bridge link."
  echo "    Its password is in $KIT_GM_ENV (root only, mode 600): the PC reads it with a file read over ssh; it is never printed here."
  echo "    The Assistant GM browser is stopped until MODE=down (it would join $KIT_WORLD and move the bridge link to the test world)."
  echo "    A reboot drops the Kit GM browser (nothing starts it again); MODE=down still cleans up."
  echo "    When the player is done and has left the game, run MODE=down: it deletes $PLAYER_NAME and the actors it owns,"
  echo "    stops the Kit GM browser, deletes $KIT_GM_USER and its password file (the bridge user goes back to what it was),"
  echo "    puts options.json back on ${orig_world:-no world} and starts Foundry and the Assistant GM browser again."
  echo "    $prev_note"
  exit 0
fi

# ---- MODE=down ----------------------------------------------------------------------------------------------------
[ -f "$STATE" ] && [ -r "$STATE" ] || die "no kit session is up ($STATE is missing or unreadable): nothing to take down. Nothing was changed"
orig_world="$(state_value ORIG_WORLD)"
was_gm_browser="$(state_value WAS_GM_BROWSER)"
state_stamp="$(state_value STAMP)"
[[ "$orig_world" =~ ^[a-z0-9-]*$ ]] || die "$STATE holds a world id I do not trust (ORIG_WORLD): check the file by hand. Nothing was changed"
[[ "$was_gm_browser" =~ ^[01]$ ]] || die "$STATE holds no valid WAS_GM_BROWSER (0 or 1): check the file by hand. Nothing was changed"
[[ "$state_stamp" =~ ^[0-9]{8}-[0-9]{6}$ ]] || die "$STATE holds no valid STAMP: check the file by hand. Nothing was changed"
# KIT_GM_BROWSER=1 when this session made a Kit GM (user, password file, profile folder, browser). A state file from
# a session started before the Kit GM existed has no such line: then there is no file and no browser to remove, and
# the teardown finds no Kit GM. A line that is there must say 1.
kit_gm_session=0
if grep -q '^KIT_GM_BROWSER=' "$STATE"; then
  [ "$(state_value KIT_GM_BROWSER)" = 1 ] || die "$STATE holds no valid KIT_GM_BROWSER (1 or no such line): check the file by hand. Nothing was changed"
  kit_gm_session=1
fi
# ORIG_BRIDGE_USER: the bridge user the setup replaced (empty: Any GM). A state file without the line (a session
# from before it existed) means Any GM. A line that is there must hold a user id or nothing.
if grep -q '^ORIG_BRIDGE_USER=' "$STATE"; then
  orig_bridge="$(state_value ORIG_BRIDGE_USER)"
  [[ "$orig_bridge" =~ ^([A-Za-z0-9]{16})?$ ]] || die "$STATE holds no valid ORIG_BRIDGE_USER (a 16 character user id or nothing): check the file by hand. Nothing was changed"
  have_orig_bridge=1
fi
[ -f "$envf" ] && env_has_login || die "no GM login for $KIT_WORLD in $envf: nothing was changed"
[ -f "$TOOL_DIR/app/package.json" ] || die "the tool is not built at $TOOL_DIR/app: run stage 5 first"
[ "$(current_world)" = "$KIT_WORLD" ] || die "options.json does not launch $KIT_WORLD (it launches '$(current_world)'): the kit session is not up. Nothing was changed"
driver_available || die "no kit-session.mjs (not installed in $driver_dir, no upload in $SESSION_DRIVER): scp scripts/pi/remote/kit-session.mjs foundry-pi:/root/ first"
systemctl is-active --quiet foundry.service || die "Foundry is not running: start it (systemctl start foundry) and run MODE=down again. Nothing was changed"
world_up || die "$KIT_WORLD is not answering on port 30000 (see: journalctl -u foundry -n 50). Nothing was changed"
# The Kit GM browser is joined to strahd-kit and would count as online: it stops first. From here on it stays
# stopped when the run stops (the kit session has no use for it any more; MODE=down can run again).
ONLINE_NOTE=""
if [ "$kit_gm_session" = 1 ]; then
  stop_kit_gm_browser
  if systemctl is-active --quiet "$KIT_GM_UNIT.service"; then
    die "the Kit GM browser ($KIT_GM_UNIT) did not stop: see systemctl status $KIT_GM_UNIT. Nothing else was changed"
  fi
  ONLINE_NOTE=" (the Kit GM browser is stopped now and stays stopped; run MODE=down again once the player has left)"
fi
# A reboot during the session starts the Assistant GM browser, which joins strahd-kit and would count as online.
systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
check_nobody_online "the Kit Player must leave the game first"

say "the in-browser part"
install_driver

# The teardown runs while strahd-kit still runs. If it fails nothing else has changed and this can run again.
say "deleting $PLAYER_NAME, the actors it owns and $KIT_GM_USER in $KIT_WORLD"
run_driver teardown || die "the teardown in $KIT_WORLD failed or did not verify (see the lines above): nothing else was changed; Foundry still runs $KIT_WORLD, the state file and the Kit GM password file stay and the Kit GM browser stays stopped, so run MODE=down again"
# Only now, with the teardown verified, the Kit GM password file and profile folder go (without them MODE=up would find
# a leftover). Removed before the next line is printed: a dropped ssh session must not stop the removal.
if [ "$kit_gm_session" = 1 ]; then remove_kit_gm_files; fi
ok "$PLAYER_NAME, its actors and $KIT_GM_USER are gone from $KIT_WORLD, read back"
if [ "$kit_gm_session" = 1 ]; then ok "removed the Kit GM password file and browser profile"; fi

# From here on the kit session ends. halted: Foundry was stopped by this run; restored: options.json launches
# ORIG_WORLD again and the state file is gone (the session is over). A failure leaves what is still true:
# before "restored" the state file stays, so MODE=down can run again; after it the Assistant GM browser comes back.
halted=0
restored=0
back_exit() {
  # A dropped ssh session closes our output (SIGPIPE, HUP): the steps below must still all run.
  set +e
  trap '' PIPE HUP
  if [ "$restored" = 0 ]; then
    if [ "$halted" = 1 ]; then systemctl start foundry.service; fi
    warn "options.json still launches $KIT_WORLD and the state file stays (nothing was put back): start Foundry if it is stopped and run MODE=down again"
    return 0
  fi
  # The session is over, whether or not the run got any further: a dropped ssh session while Foundry stops or
  # starts must leave Foundry running and the Assistant GM browser back.
  if [ "$halted" = 1 ] && ! systemctl is-active --quiet foundry.service; then systemctl start foundry.service; fi
  came_back=0
  if systemctl is-active --quiet foundry.service && world_up; then
    came_back=1
  else
    warn "Foundry did not come back on '${orig_world:-no world}' (see: journalctl -u foundry -n 50); the kit session is over and options.json is restored"
  fi
  if [ "$was_gm_browser" = 1 ]; then
    if systemctl is-active --quiet foundry.service; then
      if ! systemctl is-active --quiet foundry-ai-tool-gm-browser.service; then
        systemctl start foundry-ai-tool-gm-browser.service
        warn "the Assistant GM browser was started again; check it once Foundry runs"
      fi
    else
      warn "Foundry is stopped, so the Assistant GM browser was not started: after fixing Foundry, run systemctl start foundry-ai-tool-gm-browser"
    fi
  fi
  return 0
}
trap back_exit EXIT

say "Foundry launches ${orig_world:-no world} again"
halted=1
systemctl stop foundry.service
set_world "$orig_world"
restored=1
rm -f "${STATE:?}"
ok "options.json launches ${orig_world:-no world}; state file removed"
since="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl start foundry.service
if [ -n "$orig_world" ]; then
  wait_for_world "$orig_world"
  ok "$orig_world is running"
fi
trap - EXIT

if [ "$was_gm_browser" = 1 ]; then
  systemctl restart foundry-ai-tool-gm-browser.service
  sleep 2
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service || die "the Assistant GM browser did not start; see: journalctl -u foundry-ai-tool-gm-browser -n 50"
  if [ -n "$orig_world" ]; then
    joined=0
    for _ in $(seq 1 45); do
      if journalctl -u foundry-ai-tool-gm-browser --since "$since" --no-pager | grep -q 'joined world'; then
        joined=1
        break
      fi
      sleep 2
    done
    journalctl -u foundry-ai-tool-gm-browser -n 5 --no-pager | grep 'assistant-gm' || true
    if [ "$joined" = 1 ]; then
      ok "the Assistant GM browser joined the world"
    else
      warn "no 'joined world' yet; see: journalctl -u foundry-ai-tool-gm-browser -n 30"
    fi
  fi
else
  ok "the Assistant GM browser was not running before the kit session: left off"
fi

say "summary"
echo "    The kit session is down. $PLAYER_NAME and the actors it owned are deleted from $KIT_WORLD."
if [ "$kit_gm_session" = 1 ]; then
  echo "    The Kit GM browser is stopped, $KIT_GM_USER is deleted (the bridge user is back as it was), and its password file and profile folder are removed."
fi
echo "    Foundry launches: ${orig_world:-no world}"
echo "    The copies of $KIT_WORLD from before the session, if any, are in $IMPORT/prev-$state_stamp (kept; remove them later, only with the user's OK)"
