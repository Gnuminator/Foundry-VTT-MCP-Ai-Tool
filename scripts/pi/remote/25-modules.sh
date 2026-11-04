#!/usr/bin/env bash
# Stage 25: install the pinned Foundry modules from the PC's module archive (docs/dev/MODULE-REHEARSAL.md, "Pi: install
# from the archive"). It reads $MIRROR/pinned.json (the PC archive's mirror, put on the Pi with the scp that
# `node scripts/modules/rehearse.mjs pi-plan` prints), and for every pinned module that is not at its pinned version:
# stops the Assistant GM browser and Foundry, moves the old folder to $IMPORT/prev-<time>-modules/<id>, puts the pinned
# version in its place, starts Foundry again and reads the result back. It never downloads, never installs a version
# that is not pinned, and never switches a module on in a world: installing is not activating (the Admin set tools or
# Manage Modules do that, a separate step).
#   Only "modules" in pinned.json are installed. Systems are stage 14's (dnd5e) and Foundry is stage 3's; the bridge
#   (foundry-mcp-bridge) is stage 5's and aitool-content is stage 11's: a pin for either is skipped with a line.
#
# Order in a Pi sitting: stages 3, 14, 5 and 13 first (Foundry 14.369 needs the installed login drivers to know its user
# select, see the refusal below), this stage next, the Docker cutover (stages 23 and 24, which restart foundry.service
# too) after it. The install goes into the one modules folder every world on the Pi shares, so it applies to all worlds at
# once, and Foundry restarts into whichever world launches: test the versions on the PC test server and its kit first,
# then run this stage once on the Pi (a kit session must be down, see the refusal below). A snapshot before it. Stage 22
# (seven books) runs after the content modules changed. The Docker cutover guard (Backlog item refuse_when_cut_over) will
# refuse this stage once the stack is cut over; it does not exist in the script yet.
#
# Nothing changes before the checks pass, and the checks are the whole of a dry run (no APPLY): the pins and the
# mirror, every zip's sha256 (of a copy), its entry names (no absolute path, no "..", no link or device in what is
# unpacked), the room on the disk (all zips unpacked at once plus the largest zip), the module.json inside (its id and
# version must be the pin's), and (for a real run) a snapshot from today, nobody online and no recording, no kit
# session, no open dnd5e trial, Foundry running with a world. The last run's state is in $STATE; UNDO=1 puts that run's
# old folders back (a module that had no old folder is moved aside, never deleted) and reads the versions back. A real
# run is refused while the state says an earlier run did not finish (phase=installing): UNDO=1 first.
# A real run that fails after Foundry stopped (an unpack, a move, the start, the read-back) undoes what it did in the
# same way and starts Foundry and the Assistant GM browser as they were. Nothing is deleted: old and replaced folders
# stay under $IMPORT (prev-<time>-modules, failed-<time>-modules) until the user removes them.
#
#   scp -r <archive>/modules <archive>/pinned.json foundry-pi:<MIRROR>/     (pi-plan prints the command)
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/25-modules.sh | ssh foundry-pi 'bash -s'            a dry run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/25-modules.sh | ssh foundry-pi 'APPLY=1 bash -s'    the real run
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/25-modules.sh | ssh foundry-pi 'UNDO=1 bash -s'     the last run back
# Env (in front of bash): APPLY=1 (anything else but empty is refused), UNDO=1, MIRROR (default
# /home/dietpi/module-archive), ONLY (comma separated module ids: install just those), FORCE=1 (players or recording
# check only, never the snapshot). Take the snapshot (/boot/dietpi/dietpi-backup 1) and get the user's OK before APPLY=1
# or UNDO=1. The one run at a time is a lock in $IMPORT; in a real run or UNDO every line also goes to $STAGE_LOG.

require_root
MIRROR="${MIRROR:-/home/dietpi/module-archive}"
ONLY="${ONLY:-}"
APPLY="${APPLY:-}"
UNDO="${UNDO:-}"
IMPORT=/var/lib/foundry-import
STATE="$IMPORT/modules-stage.state"
LOG_FILE="$IMPORT/modules-stage.log" # lib.sh out() writes every line to $STAGE_LOG once it is set below
data="$FOUNDRY_DATA/Data"
moddir="$data/modules"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"
ID_RE='^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$'
VERSION_RE='^[A-Za-z0-9][A-Za-z0-9_.+-]{0,60}$'

case "$APPLY" in "" | 1) ;; *) die "APPLY must be 1 or left out (got '$APPLY'). Nothing was changed" ;; esac
case "$UNDO" in "" | 1) ;; *) die "UNDO must be 1 or left out (got '$UNDO'). Nothing was changed" ;; esac
[ -z "$APPLY" ] || [ -z "$UNDO" ] || die "APPLY=1 and UNDO=1 together: pick one. Nothing was changed"
[[ "$MIRROR" == /* && "$MIRROR" != *..* ]] || die "MIRROR must be an absolute path without '..' (got '$MIRROR'). Nothing was changed"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first. Nothing was changed"
command -v unzip >/dev/null || die "unzip is not installed (apt install unzip). Nothing was changed"
[ -d "$moddir" ] || die "no $moddir: Foundry has not run here yet (stage 3). Nothing was changed"
[ ! -e "$TOOL_DATA/kit-session.env" ] || die "a kit session is up ($TOOL_DATA/kit-session.env exists, the Kit GM browser holds strahd-kit): run kit-session.sh MODE=down first. Nothing was changed"
refuse_during_system_trial "stage 25 (modules)"
install -d -m 700 "$IMPORT"
exec 9>"$IMPORT/modules-stage.lock"
flock -n 9 || die "another stage 25 run holds $IMPORT/modules-stage.lock. Nothing was changed"
trap '' HUP PIPE
if [ -n "$APPLY$UNDO" ]; then STAGE_LOG="$LOG_FILE"; else STAGE_LOG=""; fi
if [ -n "$UNDO" ]; then run_word=UNDO; elif [ -n "$APPLY" ]; then run_word=APPLY; else run_word="dry run"; fi
ok "$run_word started${STAGE_LOG:+ (logged in $STAGE_LOG)}"
[ -z "$APPLY$UNDO" ] || require_recent_snapshot

# ---- helpers -----------------------------------------------------------------------------------------------
json_get() { # $1 file, $2 key: one printable string field of a JSON file (a BOM is allowed); empty when missing
  node -e 'try{let s=require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,"");const v=JSON.parse(s)[process.argv[2]];if(v!=null)process.stdout.write(String(v).replace(/[^\w.+-]/g,"?").slice(0,60))}catch{}' "$1" "$2"
}
mod_version() { json_get "$moddir/$1/module.json" version; }
world_up() { # the join page of a running world; curl's output is captured first so grep -q cannot SIGPIPE it
  local page
  page="$(curl -fs --max-time 5 http://127.0.0.1:30000/join 2>/dev/null || true)"
  [[ "$page" == *'id="join-game"'* ]]
}
GM_UNIT=foundry-ai-tool-gm-browser.service
# wait_back_up: after Foundry was started, wait for its world and (when it ran before) the Assistant GM browser to join it
# in its current run (lib.sh browser_joined: the systemd invocation id, so a line from before the restart does not count).
# Returns 1 when the world did not come back, 2 when the browser did not join.
wait_back_up() {
  local _
  have_systemd || return 0
  if [ "${expect_world:-1}" != 1 ]; then
    warn "no world answered before the restart, so none is awaited now (an UNDO of a run that left Foundry without a world)"
    return 0
  fi
  for _ in $(seq 1 60); do
    world_up && break
    sleep 2
  done
  world_up || return 1
  ok "Foundry is up"
  [ "$was_gm_browser" = 1 ] || return 0
  for _ in $(seq 1 45); do
    if browser_joined "$GM_UNIT"; then
      ok "the Assistant GM browser joined the world"
      return 0
    fi
    sleep 2
  done
  return 2
}
require_world_running() { # a stage that restarts Foundry needs it running with a world now: a stopped one has nothing to come back to
  have_systemd || return 0
  systemctl is-active --quiet foundry.service || die "foundry.service is not running (start it, with the world, first). Nothing was changed"
  world_up || die "Foundry runs, but no world answers on port 30000 (launch the world first). Nothing was changed"
}
free_path() { # $1, or $1.2, $1.3 ... when it exists
  local p="$1" n=2
  while [ -e "$p" ] || [ -L "$p" ]; do
    p="$1.$n"
    n=$((n + 1))
  done
  printf '%s' "$p"
}
check_room() { # $1 a path on the filesystem, $2 the bytes the run writes there (the storage rule of stage 10)
  local avail size left pct
  read -r avail size < <(df --output=avail,size -B1 "$1" | tail -n1)
  [ "${size:-0}" -gt 0 ] || die "cannot read the free space of $1. Nothing was changed"
  left=$((avail - $2))
  pct=$((left * 100 / size))
  if [ "$left" -lt $((size / 20)) ]; then
    die "not enough space: $avail bytes free, the run writes $2, which would leave $pct% (under 5%). Nothing was changed"
  elif [ "$pct" -lt 20 ]; then
    warn "space gets low: $pct% free after the run's $2 bytes (the rule is 20%); going on"
  else
    ok "room for the run's $2 bytes ($pct% free after)"
  fi
}

# The state file: stamp=, prev= (where the old folders went), failed= (where replaced new ones go), phase= and one
# module=<id>|<old version or NONE>|<new version> per module the run changes. It is written (atomically) before the
# first move, so the trap and UNDO=1 know every folder that may have moved.
state_get() { [ -f "$STATE" ] && sed -n "s/^$1=//p" "$STATE" | head -n1 || true; }
state_modules() { [ -f "$STATE" ] && sed -n 's/^module=//p' "$STATE" || true; }
state_phase() { # $1 the phase word: rewrites that one line
  { grep -v '^phase=' "$STATE" || true; printf 'phase=%s\n' "$1"; } >"$STATE.new"
  mv -f "$STATE.new" "$STATE"
}

# Puts the folders back that the state file lists: the old one from prev/<id> when it moved, and the new folder aside to
# failed/<id> (only when it is the state's new version, or when the old one moved out and something else sits in its
# place). A module with no old folder (old NONE) is moved aside when its new folder is there. Safe to run twice.
undo_state() {
  local prev failed id old new moved=0 cur rc=0
  prev="$(state_get prev)"
  failed="$(state_get failed)"
  [ -n "$prev" ] && [ -n "$failed" ] || return 0
  # Every move is checked by hand: this runs inside "||" and in the exit trap, where errexit does not stop it, so a failed
  # move must not read as "is back". mv -T never puts a folder inside one that is already there. The return value is 1
  # when any folder could not be put back (a failed module does not stop the others).
  while IFS='|' read -r id old new; do
    [[ "$id" =~ $ID_RE ]] || continue
    cur="$(mod_version "$id")"
    if [ -d "$prev/$id" ]; then
      if [ -e "$moddir/$id" ] || [ -L "$moddir/$id" ]; then
        install -d -m 700 "$failed" && mv -T "$moddir/$id" "$(free_path "$failed/$id")" || {
          warn "$id: cannot move $moddir/$id aside to $failed; the old folder stays in $prev/$id"
          rc=1
          continue
        }
      fi
      mv -T "$prev/$id" "$moddir/$id" || {
        warn "$id: cannot move $prev/$id back to $moddir/$id"
        rc=1
        continue
      }
      ok "$id: $old is back (replaced $new moved to $failed)"
      moved=1
    elif [ "$old" = NONE ] && [ -d "$moddir/$id" ] && [ "$cur" = "$new" ]; then
      install -d -m 700 "$failed" && mv -T "$moddir/$id" "$(free_path "$failed/$id")" || {
        warn "$id: cannot move $moddir/$id aside to $failed"
        rc=1
        continue
      }
      ok "$id: was not installed before, $new moved aside to $failed"
      moved=1
    fi
  done < <(state_modules)
  [ "$moved" = 1 ] || [ "$rc" = 1 ] || ok "nothing to put back"
  return "$rc"
}

stopped=0
was_foundry=0
was_gm_browser=0
work=""
undo=""
stop_services() {
  have_systemd || {
    warn "no systemd here (a test container?): nothing to stop"
    return 0
  }
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service && was_gm_browser=1
  say "stopping the Assistant GM browser and Foundry"
  stopped=1
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  systemctl stop foundry.service
}
start_services() { # as they were before the run
  have_systemd || return 0
  if [ "$was_foundry" = 1 ]; then systemctl restart foundry.service || return 1; fi
  if [ "$was_gm_browser" = 1 ]; then
    systemctl is-active --quiet foundry-ai-tool-gm-browser.service || systemctl start foundry-ai-tool-gm-browser.service || return 1
  fi
}
on_exit() {
  set +e # errexit is off in the trap: every step below runs, whatever an earlier one did
  local restored=1
  if [ "$stopped" = 1 ] && have_systemd; then
    # Foundry may have been started again by the failed run (the read-back): stop it before folders move.
    systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null
    systemctl stop foundry.service 2>/dev/null
    if [ "$undo" = 1 ]; then
      if undo_state; then
        state_phase undone 2>/dev/null
      else
        restored=0 # the phase is installing (written here, as an UNDO of a finished run starts at installed), so the next run is refused until UNDO=1 has finished the job
        state_phase installing 2>/dev/null
        warn "putting the folders back did not finish (see above); the state in $STATE stays at phase=installing: run UNDO=1"
      fi
    fi
    start_services || warn "Foundry or the Assistant GM browser did not come back: see journalctl -u foundry -n 50"
    if [ "$restored" = 1 ]; then
      warn "the run did not finish: ${undo:+the old folders are back, }Foundry and the Assistant GM browser are as they were"
    else
      warn "the run did not finish and NOT every old folder is back; Foundry and the Assistant GM browser were started again"
    fi
  fi
  # The work folder goes last: the restore never reads it, but a failure above must not leave the run without its log lines.
  [ -z "$work" ] || rm -rf "${work:?}"
}
trap on_exit EXIT

# ---- UNDO ---------------------------------------------------------------------------------------------------
if [ -n "$UNDO" ]; then
  [ -f "$STATE" ] || die "no $STATE: there is no run to undo. Nothing was changed"
  [ "$(state_get phase)" != undone ] || die "the last run ($(state_get stamp)) is already undone. Nothing was changed"
  say "UNDO: putting back the folders of the run from $(state_get stamp)"
  # No "Foundry must be running" check here: a run killed after it stopped Foundry (the state UNDO exists for) leaves it
  # stopped, and a module that keeps the world from launching leaves no world. Both start again below, as a run began.
  require_quiet "putting the old module folders back"
  # Whether a world answers now, read before anything stops: a Foundry with no world open (the run died, or a module kept
  # the world from launching) has none to wait for after the restart, and waiting 120 s for it would end in a failure.
  # A Foundry that is down (a killed run stopped it) had a world: it is awaited. Only a running Foundry with no world is not.
  expect_world=1
  if have_systemd && systemctl is-active --quiet foundry.service && ! world_up; then expect_world=0; fi
  stop_services
  was_foundry=1
  if have_systemd && systemctl is-enabled --quiet "$GM_UNIT" 2>/dev/null; then was_gm_browser=1; fi
  undo=1
  # A failed restore marks the run unfinished (a new APPLY=1 is refused) and clears undo, so the exit trap does not retry it
  # on its own: the next UNDO=1 then does the whole job, with its read-back.
  undo_state || {
    state_phase installing
    undo=""
    die "putting the folders back did not finish (see the lines above); the state in $STATE is at phase=installing, so APPLY=1 is refused and UNDO=1 can run again once the cause is fixed"
  }
  state_phase undone
  undo=""
  start_services || die "the old folders are back, but Foundry did not start: journalctl -u foundry -n 50"
  stopped=0 # started again: a later failure (the read-back) must not run the exit trap's stop and restart a second time
  wait_back_up || die "the old folders are back, but Foundry or the Assistant GM browser did not come up again: journalctl -u foundry -n 50 and journalctl -u foundry-ai-tool-gm-browser -n 30"
  say "reading the old versions back"
  mismatch=0
  while IFS='|' read -r id old new; do
    [[ "$id" =~ $ID_RE ]] || continue
    now="$(mod_version "$id")"
    case "$old" in
      unknown) ok "$id: the old folder had no readable module.json, so no version to compare" ;;
      NONE)
        if [ -e "$moddir/$id" ]; then
          warn "$id: was not installed before, but $moddir/$id exists (version '${now:-?}')"
          mismatch=1
        else
          ok "$id: not installed, as before"
        fi
        ;;
      *)
        if [ "$now" = "$old" ]; then
          ok "$id $now"
        else
          warn "$id: $moddir/$id/module.json says '${now:-?}', the run changed it from $old"
          mismatch=1
        fi
        ;;
    esac
  done < <(state_modules)
  [ "$mismatch" = 0 ] || die "UNDO finished, but the versions above do not match the state in $STATE. Check them by hand"
  trap - EXIT
  if [ "$was_gm_browser" = 1 ]; then
    ok "the old module folders are back; Foundry and the Assistant GM browser are started again"
  else
    ok "the old module folders are back; Foundry is started again (the Assistant GM browser was not enabled)"
  fi
  exit 0
fi

# An earlier real run that did not finish (killed, power cut) leaves phase=installing: some old folders may have moved.
# A new run would rotate that state away and lose where they went, so UNDO=1 has to come first.
if [ "$(state_get phase)" = installing ]; then
  msg="the last run ($(state_get stamp)) did not finish (phase=installing in $STATE): module folders may have moved. Run UNDO=1 first"
  if [ -n "$APPLY" ]; then die "$msg. Nothing was changed"; else warn "$msg"; fi
fi

# ---- checks (a dry run is these) ----------------------------------------------------------------------------
say "reading $MIRROR/pinned.json"
[ -d "$MIRROR" ] && [ ! -L "$MIRROR" ] || die "no folder $MIRROR (copy the archive's modules and pinned.json there first, see the header). Nothing was changed"
[ -f "$MIRROR/pinned.json" ] && [ ! -L "$MIRROR/pinned.json" ] || die "no $MIRROR/pinned.json. Nothing was changed"
pins="$(node -e '
const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const m = o.modules;
if (!m || typeof m !== "object" || Array.isArray(m)) { console.error("pinned.json has no modules object"); process.exit(3); }
for (const [id, p] of Object.entries(m)) {
  if (!p || typeof p !== "object") { console.error("the pin of " + id + " is not an object"); process.exit(3); }
  const f = v => String(v ?? "-").replace(/[\t\r\n]/g, "?");
  console.log([id, p.version, p.file, p.sha256].map(f).join("\t"));
}
' "$MIRROR/pinned.json")" || die "cannot read the modules in $MIRROR/pinned.json. Nothing was changed"
[ -n "$pins" ] || die "pinned.json pins no module. Nothing was changed"

# Foundry 14.369 picks the user from a list in the join form; the login drivers the Pi installed from stage 5 (and the
# kit run that follows this stage) must know that or the Assistant GM browser cannot rejoin the world after the restart.
foundry_version="$(json_get "$FOUNDRY_APP/package.json" version)"
if [ -n "$foundry_version" ] && node -e 'const a=process.argv[1].split(".").map(Number),b=[14,369];process.exit((a[0]>b[0]||(a[0]===b[0]&&(a[1]??0)>=b[1]))?0:1)' "$foundry_version"; then
  driver="$TOOL_DIR/gm-browser/assistant-gm.mjs"
  if [ -f "$driver" ] && ! grep -q selectOption "$driver"; then
    die "Foundry $foundry_version picks the user from a list, but the installed $driver only types the name (it has no selectOption): run stage 5 (and 13) again first. Nothing was changed"
  fi
fi

# The work folder sits in Foundry's Data folder (a dot folder Foundry does not read), owned by root, so root never writes into
# a folder the foundry user controls. Only $work/<id> belongs to the foundry user: the zips are unpacked there as that user,
# not as root, so nothing an entry does can write outside what the foundry user may write. $IMPORT is
# root-only and holds the kept folders (prev-*, failed-*) and the state. Same filesystem as $moddir, so the moves never copy.
work="$data/.stage25-work-$stamp"
install -d -m 755 "$work" # root-owned: root copies the zips in here, and only $work/<id> (below) belongs to the foundry user
[ "$(stat -c %d "$work")" = "$(stat -c %d "$moddir")" ] || die "$work and $moddir are on different filesystems: the folder moves would copy. Nothing was changed"
[ "$(stat -c %d "$work")" = "$(stat -c %d "$IMPORT")" ] || die "$work and $IMPORT are on different filesystems: the old folders would be copied, not moved. Nothing was changed"

# The copies of the zips come first: their room is checked before the first copy (the unpacked room follows pass 1).
zip_total=0
while IFS=$'\t' read -r id _ file _; do
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$id,"* ]]; then continue; fi
  [[ "$file" =~ ^modules/[A-Za-z0-9_.-]+/[A-Za-z0-9_.+-]+/[A-Za-z0-9_.+-]+\.zip$ ]] && [[ "$file" != *..* ]] || continue # pass 1 refuses it with its own line
  [ -f "$MIRROR/$file" ] && [ ! -L "$MIRROR/$file" ] || continue
  zip_total=$((zip_total + $(stat -c %s "$MIRROR/$file")))
done <<<"$pins"
check_room "$work" "$zip_total"

# Pass 1 checks the pins and every zip (a copy of it) without unpacking anything and adds up the room the unpacking needs;
# the room is checked once, before pass 2 unpacks.
checked=() # id|version of every pin that pass 2 unpacks
unpacked_bytes=0
biggest_zip=0
while IFS=$'\t' read -r id version file sha; do
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$id,"* ]]; then continue; fi
  case "$id" in
    foundry-mcp-bridge | aitool-content)
      warn "$id is pinned, but it is not installed by this stage (stage 5 installs the bridge, stage 11 the content module): skipped"
      continue
      ;;
  esac
  [[ "$id" =~ $ID_RE ]] && [[ "$id" != *..* ]] || die "'$id' is not a safe module id in pinned.json. Nothing was changed"
  [[ "$version" =~ $VERSION_RE ]] && [[ "$version" != *..* ]] || die "$id: '$version' is not a safe version in pinned.json. Nothing was changed"
  [ "$file" = "modules/$id/$version/$id-$version.zip" ] || die "$id: the pin's file is '$file', not modules/$id/$version/$id-$version.zip. Nothing was changed"
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "$id: the pin has no sha256 (64 hex digits). Nothing was changed"
  zip="$MIRROR/$file"
  [ -f "$zip" ] && [ ! -L "$zip" ] || die "$id: no file $zip (a link does not count). Nothing was changed"
  # Everything below works on a copy, so the file cannot change between the check and the unpack.
  install -d -m 755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$work/$id"
  cp -- "$zip" "$work/$id.zip"
  chmod 644 "$work/$id.zip"
  got="$(sha256sum "$work/$id.zip" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || die "$id: the zip's sha256 is $got, not the pinned $sha: damaged or not the pinned build. Nothing was changed"
  while IFS= read -r name; do
    case "$name" in
      /* | *\\* | ../* | */../* | */.. | ..) die "$id: the zip has an entry outside its folder (\"$name\"). Nothing was changed" ;;
    esac
  done < <(unzip -Z1 "$work/$id.zip" </dev/null)
  # zipinfo marks a link with an "l" in its permission column; none may be written (an entry through a link could land
  # anywhere the foundry user can write, which is where the zip is unpacked as). The listing is captured first (a failed
  # unzip must not read as "no link") and awk reads all of it (a grep -q that stops early would SIGPIPE unzip on a large
  # zip). The unpacked folder is already the foundry user's; the chown when it moves into place only makes sure of it.
  listing="$(unzip -Z "$work/$id.zip" </dev/null)" || die "$id: cannot read the zip's entries. Nothing was changed"
  if awk '/^l/ { f = 1 } END { exit !f }' <<<"$listing"; then die "$id: the zip holds a link. Nothing was changed"; fi
  zbytes="$(unzip -Zt "$work/$id.zip" </dev/null | awk '/bytes uncompressed/ { print $3 }' || true)"
  [[ "$zbytes" =~ ^[0-9]+$ ]] || die "$id: cannot read the zip's unpacked size. Nothing was changed"
  unpacked_bytes=$((unpacked_bytes + zbytes))
  zfile=$(stat -c %s "$work/$id.zip")
  [ "$zfile" -le "$biggest_zip" ] || biggest_zip=$zfile
  checked+=("$id|$version")
done <<<"$pins"
check_room "$work" "$((unpacked_bytes + biggest_zip))"

plan=() # id|old|new|croot (the unpacked folder that holds module.json)
unchanged=0
for entry in "${checked[@]}"; do
  IFS='|' read -r id version <<<"$entry"
  runuser -u "$FOUNDRY_USER" -- unzip -q "$work/$id.zip" -d "$work/$id" </dev/null || die "$id: cannot unpack the zip. Nothing was changed"
  rm -f "$work/$id.zip"
  [ -z "$(find "$work/$id" ! -type f ! -type d -print -quit)" ] || die "$id: the zip holds a link or special file. Nothing was changed"
  croot=""
  if [ -f "$work/$id/module.json" ]; then
    croot="$work/$id"
  else
    for d in "$work/$id"/*/; do
      if [ -f "${d}module.json" ]; then
        croot="${d%/}"
        break
      fi
    done
  fi
  [ -n "$croot" ] || die "$id: the zip has no module.json (at its root or one folder down). Nothing was changed"
  inner_id="$(json_get "$croot/module.json" id)"
  inner_version="$(json_get "$croot/module.json" version)"
  [ "$inner_id" = "$id" ] || die "$id: the zip holds module '${inner_id:-?}'. Nothing was changed"
  [ "$inner_version" = "$version" ] || die "$id: the zip's module.json says version '${inner_version:-?}', the pin says $version. Nothing was changed"
  old="$(mod_version "$id")"
  if [ -L "$moddir/$id" ]; then die "$moddir/$id is a link. Nothing was changed"; fi
  if [ "$old" = "$version" ]; then
    unchanged=$((unchanged + 1))
    out "    $id $version: already installed"
    continue
  fi
  if [ ! -e "$moddir/$id" ]; then
    old=NONE
  elif [ -z "$old" ]; then
    warn "$id: $moddir/$id has no readable module.json; it will be moved aside like an old version"
    old=unknown
  fi
  plan+=("$id|$old|$version|$croot")
  out "    $id: ${old/NONE/not installed} -> $version"
done

if [ -n "$ONLY" ]; then
  for want in ${ONLY//,/ }; do
    awk -F'\t' -v w="$want" '$1 == w { f = 1 } END { exit !f }' <<<"$pins" || die "ONLY names $want, which is not in pinned.json. Nothing was changed"
  done
fi
ok "${#plan[@]} module(s) to change, $unchanged already at the pinned version"
if [ "${#plan[@]}" -eq 0 ]; then
  ok "nothing to do"
  trap - EXIT
  [ -z "$work" ] || rm -rf "${work:?}"
  exit 0
fi

if [ -z "$APPLY" ]; then
  ok "dry run: nothing was changed (APPLY=1 for the real run, after a snapshot and the user's OK)"
  trap - EXIT
  rm -rf "${work:?}"
  exit 0
fi

# ---- the real run -------------------------------------------------------------------------------------------
require_world_running
require_quiet "installing modules"
since="$(date '+%F %T')" # the journal reads below start here, so a line from before the restart cannot count
prev="$IMPORT/prev-$stamp-modules"
failed="$IMPORT/failed-$stamp-modules"
install -d -m 700 "$prev"
[ ! -f "$STATE" ] || mv -f "$STATE" "$STATE.last"
{
  printf 'stamp=%s\nprev=%s\nfailed=%s\nphase=installing\n' "$stamp" "$prev" "$failed"
  for row in "${plan[@]}"; do
    IFS='|' read -r id old new _ <<<"$row"
    printf 'module=%s|%s|%s\n' "$id" "$old" "$new"
  done
} >"$STATE.new"
mv -f "$STATE.new" "$STATE"
ok "state written to $STATE (UNDO=1 reads it)"

stop_services
undo=1
for row in "${plan[@]}"; do
  IFS='|' read -r id old new croot <<<"$row"
  [ ! -e "$moddir/$id" ] || mv "$moddir/$id" "$prev/$id"
  mv "$croot" "$moddir/$id"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$moddir/$id"
  ok "$id: ${old/NONE/not installed} -> $new (old folder: $prev/$id)"
done

# ---- start and read back --------------------------------------------------------------------------------------
if have_systemd; then
  say "starting Foundry again"
  systemctl restart foundry.service
  [ "$was_gm_browser" != 1 ] || enable_unit "$GM_UNIT"
  rc=0
  wait_back_up || rc=$?
  case "$rc" in
    0) ;;
    1) die "Foundry's world did not come back on port 30000 (the old folders are put back; see: journalctl -u foundry -n 50)" ;;
    *) die "the Assistant GM browser did not join the world again (the old folders are put back; see: journalctl -u foundry-ai-tool-gm-browser -n 30)" ;;
  esac
else
  warn "no systemd here (a test container?): Foundry and the Assistant GM browser were not started"
fi
say "reading the installed folders back"
for row in "${plan[@]}"; do
  IFS='|' read -r id old new _ <<<"$row"
  now="$(mod_version "$id")"
  [ "$now" = "$new" ] || die "$id: $moddir/$id/module.json says '${now:-?}', not the pinned $new (the old folders are put back)"
  [ "$(stat -c %U "$moddir/$id/module.json")" = "$FOUNDRY_USER" ] || die "$id: module.json is not owned by $FOUNDRY_USER (the old folders are put back)"
  ok "$id $now"
done
# Foundry reads the module folders at start; the journal since the restart names a module it could not read.
if have_systemd; then
  bad="$(journalctl -u foundry --since "$since" --no-pager 2>/dev/null | grep -iE 'module.*(failed|error|invalid)' | head -n 5 || true)"
  [ -z "$bad" ] || warn "Foundry's log since the start mentions a module problem:"$'\n'"$bad"
fi

undo=""
state_phase installed
trap - EXIT
rm -rf "${work:?}"
ok "done: ${#plan[@]} module(s) installed; the old folders are in $prev. Switching them on in the world is the next step (Manage Modules or the Admin set tools), then the module errors check. UNDO=1 puts the old folders back"
