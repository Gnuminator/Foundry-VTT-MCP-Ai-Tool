#!/usr/bin/env bash
# Stage 13: let players make their own level-1 characters in Actor Studio at session 0 (decisions D-112 and
# D-113, docs/dev/PI-SETUP.md). Two parts: (A) install our Actor Studio fork build, (B) in each world, set the
# Foundry and Actor Studio settings that character creation needs.
#   scp scripts/pi/remote/player-creation-settings.mjs foundry-pi:/root/ && cat scripts/pi/remote/lib.sh scripts/pi/remote/13-player-creation.sh | ssh foundry-pi 'bash -s'
# The scp copies the in-browser part (the stage installs it into /opt/foundry-ai-tool/gm-browser/ and removes the
# upload, the same way stage 5 handles assistant-gm.mjs). Environment variables go in front of bash:
#   ... | ssh foundry-pi 'WORLD=curse-of-strahd bash -s'
# Take a snapshot first (dietpi-backup 1) and get the user's OK: this stops Foundry for a few minutes.
# Env: WORLD (curse-of-strahd), KIT_WORLD (strahd-kit; empty skips it), SETTINGS_DRIVER (the uploaded .mjs,
#   default /root/player-creation-settings.mjs), STUDIO_VERSION + STUDIO_SHA256 (override the pinned build; give
#   both or neither), STUDIO_ZIP (a local zip under /var/lib/foundry-import/ instead of the download; needs
#   STUDIO_SHA256, and the zip's module.json must say STUDIO_VERSION).
# What it does:
#   A. The pinned build (below) comes from the fork's GitHub release, must match STUDIO_SHA256, and is inspected
#      before anything is extracted (no absolute paths, no .., no links, module.json says id foundryvtt-actor-studio
#      and the pinned version). If that version is already installed, part A is skipped. Otherwise the services
#      stop, the old module folder moves to /var/lib/foundry-import/prev-<stamp>/modules/ (never deleted) and the
#      new one takes its place, owned by the Foundry user like the other modules.
#   B. For each world (Foundry runs it, headless Chromium joins as the world's GM with the login in
#      /etc/foundry-ai-tool/world-<id>.env, never printed): Foundry's ACTOR_CREATE permission includes the Player
#      and Trusted Player roles (the roles already there stay), Actor Studio's enableEquipmentSelection is on and
#      its equipment source is dnd-players-handbook.equipment. The values before and after are printed and read
#      back after a reload (player-creation-settings.mjs). Safe to run again: nothing changes the second time.
#   Afterwards options.json launches the world it launched before, Foundry and the Assistant GM browser start
#   and the stage waits for "joined world". If the run fails after Foundry was stopped, options.json is put back
#   (and the old module, if the install had not finished) and both start again. Space is checked first (20%
#   free warns, under 5% stops). Without systemd (a test container) part B is skipped with a warning.

require_root
require_arm64

# The pinned build. PENDING-RELEASE means the release does not exist yet: the stage then refuses to run unless
# the environment gives it a zip and a checksum (STUDIO_ZIP and STUDIO_SHA256). Replace both when the release
# is published (sha256sum of its module.zip).
PINNED_VERSION=2.10.5-aitool.4
PINNED_SHA256=PENDING-RELEASE
MODULE_ID=foundryvtt-actor-studio
RELEASE_BASE=https://github.com/Gnuminator/foundryvtt-actor-studio/releases/download
MAX_ZIP_BYTES=209715200 # 200 MiB, far above the real module (about 7 MB unpacked)

WORLD="${WORLD:-curse-of-strahd}"
KIT_WORLD="${KIT_WORLD-strahd-kit}"
STUDIO_ZIP="${STUDIO_ZIP:-}"
SETTINGS_DRIVER="${SETTINGS_DRIVER:-/root/player-creation-settings.mjs}"
IMPORT=/var/lib/foundry-import
data="$FOUNDRY_DATA/Data"
options="$FOUNDRY_DATA/Config/options.json"
studio_dir="$data/modules/$MODULE_ID"
driver_dir="$TOOL_DIR/gm-browser"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"

say "checking the request"
for id in "$WORLD" ${KIT_WORLD:+"$KIT_WORLD"}; do
  [[ "$id" =~ ^[a-z0-9-]+$ ]] || die "'$id' is not a valid world id (lowercase letters, digits, dashes)"
done
[ -z "$KIT_WORLD" ] || [ "$KIT_WORLD" != "$WORLD" ] || die "KIT_WORLD must differ from WORLD"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "no user $FOUNDRY_USER: run stage 1 first"
[ -f "$options" ] || die "no $options: has Foundry started once (stage 3)?"
[ -x "$NODE_DIR/bin/node" ] || die "no Node at $NODE_DIR: run stage 2 first"

# Which build: the pinned one, or the pair the environment gives (a test feed). A checksum is always checked.
if [ -n "$STUDIO_ZIP" ]; then
  [ -n "${STUDIO_SHA256:-}" ] || die "STUDIO_ZIP needs STUDIO_SHA256 (the sha256 of that zip)"
elif [ -n "${STUDIO_VERSION:-}" ] || [ -n "${STUDIO_SHA256:-}" ]; then
  { [ -n "${STUDIO_VERSION:-}" ] && [ -n "${STUDIO_SHA256:-}" ]; } || die "give STUDIO_VERSION and STUDIO_SHA256 together, or neither"
fi
STUDIO_VERSION="${STUDIO_VERSION:-$PINNED_VERSION}"
STUDIO_SHA256="${STUDIO_SHA256:-$PINNED_SHA256}"
STUDIO_SHA256="${STUDIO_SHA256,,}"
if [ "$STUDIO_SHA256" = "pending-release" ]; then
  die "the pinned Actor Studio build $PINNED_VERSION has no release yet (PENDING-RELEASE): give STUDIO_ZIP (a zip under $IMPORT/) and STUDIO_SHA256, or pin the published release in this script"
fi
[[ "$STUDIO_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "STUDIO_SHA256 must be 64 hex digits"
[[ "$STUDIO_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || die "'$STUDIO_VERSION' is not a valid version"
if [ -n "$STUDIO_ZIP" ]; then
  real="$(realpath -e -- "$STUDIO_ZIP" 2>/dev/null)" || die "no such zip: $STUDIO_ZIP"
  case "$real" in "$IMPORT"/*.zip) ;; *) die "STUDIO_ZIP must be a .zip under $IMPORT/ (got $real)" ;; esac
  [ -f "$real" ] || die "$real is not a regular file"
  STUDIO_ZIP="$real"
fi

# options.json "world" is what Foundry launches. Part B changes it per world; the first value is saved here and
# put back at the end and when the run fails (see on_exit).
set_world() {
  node -e 'const fs=require("fs");const p=process.argv[1];const o=JSON.parse(fs.readFileSync(p,"utf8"));o.world=process.argv[2]||null;fs.writeFileSync(p,JSON.stringify(o,null,2)+"\n")' "$options" "$1"
  world_changed=1
}
orig_world="$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.world||"")' "$options")"
world_changed=0
json_field() { # $1 a .json file, $2 a top-level key; prints the value when it is a string
  node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];process.stdout.write(typeof v==="string"?v:"")}catch{}' "$1" "$2"
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

# What part B needs. Checked before anything is stopped or changed.
run_b=0
worlds=("$WORLD")
[ -z "$KIT_WORLD" ] || worlds+=("$KIT_WORLD")
if have_systemd; then
  run_b=1
  for id in "${worlds[@]}"; do
    [ -f "$data/worlds/$id/world.json" ] || die "world $id is not installed ($data/worlds/$id/world.json): run stage 11 first, or leave it out (KIT_WORLD= for the kit world)"
    [ -f "$TOOL_ETC/world-$id.env" ] || die "no $TOOL_ETC/world-$id.env (the GM login stage 11 writes): run stage 11 first"
  done
  [ -f "$TOOL_DIR/app/package.json" ] || die "the tool is not built at $TOOL_DIR/app: run stage 5 first"
else
  warn "no systemd here (a test container?): part B (the world settings) will be skipped"
fi

say "the in-browser part"
if [ -f "$SETTINGS_DRIVER" ]; then
  install -d -m 755 "$driver_dir"
  install -m 0644 "$SETTINGS_DRIVER" "$driver_dir/player-creation-settings.mjs"
  rm -f "$SETTINGS_DRIVER"
  ok "installed $driver_dir/player-creation-settings.mjs"
elif [ -f "$driver_dir/player-creation-settings.mjs" ]; then
  ok "already installed (no new copy in $SETTINGS_DRIVER)"
else
  die "no $SETTINGS_DRIVER: scp scripts/pi/remote/player-creation-settings.mjs foundry-pi:/root/ first"
fi

install -d -m 700 "$IMPORT"
work="$IMPORT/work-$stamp"
prev="$IMPORT/prev-$stamp"
install -d -m 700 "$work"
# install_state: 0 nothing moved, 1 the module swap is under way, 2 done. A failure in state 1 puts the old
# module folder back. A failure after the services stopped puts options.json, Foundry and the Assistant GM
# browser back as they were, so the Pi is never left in a half state.
install_state=0
stopped=0
was_foundry=0
was_gm_browser=0
on_exit() {
  if [ "$install_state" = 1 ]; then
    rm -rf "${studio_dir:?}"
    if [ -d "$prev/modules/$MODULE_ID" ]; then
      mv "$prev/modules/$MODULE_ID" "$studio_dir" || true
    fi
    rmdir "$prev/modules" "$prev" 2>/dev/null || true
    warn "the Actor Studio swap did not finish: the old module folder is back (if there was one)"
  fi
  if [ "$stopped" = 1 ] && have_systemd; then
    if [ "$world_changed" = 1 ]; then
      set_world "$orig_world" || true
      warn "options.json restored to launch '${orig_world:-no world}'"
    fi
    if [ "$was_foundry" = 1 ]; then
      systemctl restart foundry.service || true
    else
      systemctl stop foundry.service 2>/dev/null || true
    fi
    if [ "$was_gm_browser" = 1 ]; then
      systemctl is-active --quiet foundry-ai-tool-gm-browser.service || systemctl start foundry-ai-tool-gm-browser.service || true
    fi
    warn "the run did not finish: Foundry and the Assistant GM browser are back as they were before it"
    if [ -d "$prev" ]; then warn "old copies are in $prev"; fi
  fi
  rm -rf "${work:?}"
}
trap on_exit EXIT

# ---- part A: the Actor Studio build ----------------------------------------------------------------------
say "Actor Studio $STUDIO_VERSION"
installed_version=""
if [ -f "$studio_dir/module.json" ] && [ "$(json_field "$studio_dir/module.json" id)" = "$MODULE_ID" ]; then
  installed_version="$(json_field "$studio_dir/module.json" version)"
fi
need_install=1
if [ "$installed_version" = "$STUDIO_VERSION" ]; then
  need_install=0
  ok "$MODULE_ID $installed_version is already installed: part A skipped"
else
  ok "installed: ${installed_version:-nothing}; wanted: $STUDIO_VERSION"
fi

if [ "$need_install" = 1 ]; then
  apt_install unzip curl ca-certificates
  check_space "$IMPORT" "$IMPORT"
  check_space "$FOUNDRY_DATA" "$FOUNDRY_DATA"
  zip="$work/module.zip"
  if [ -n "$STUDIO_ZIP" ]; then
    zip="$STUDIO_ZIP"
    ok "using the local zip $zip"
  else
    url="$RELEASE_BASE/$STUDIO_VERSION/module.zip"
    say "downloading $url"
    curl --proto '=https' --proto-redir '=https' -fsSL --retry 3 --max-time 300 --max-filesize "$MAX_ZIP_BYTES" -o "$zip" "$url" || die "the download failed (is there a release $STUDIO_VERSION?)"
  fi
  actual="$(sha256sum "$zip" | cut -d' ' -f1)"
  [ "$actual" = "$STUDIO_SHA256" ] || die "the checksum does not match (expected $STUDIO_SHA256, got $actual): nothing was extracted"
  ok "sha256 matches"

  say "inspecting the zip before extracting"
  unzip -Z1 "$zip" >"$work/names" || die "cannot read the zip"
  unzip -Z "$zip" | grep -E '^[-dlbcps?][-rwxsStT]' | cut -c1 >"$work/types" || true
  [ "$(wc -l <"$work/names")" = "$(wc -l <"$work/types")" ] || die "the zip listing is inconsistent (odd file names)"
  bad=0
  while IFS= read -r t; do
    case "$t" in - | d) ;; *)
      bad=1
      break
      ;;
    esac
  done <"$work/types"
  [ "$bad" = 0 ] || die "the zip holds links, devices or other special entries; only files and folders are accepted"
  has_module_json=0
  nfiles=0
  while IFS= read -r name; do
    n="${name#./}"
    n="${n%/}"
    if [ -z "$n" ] || [ "$n" = "." ]; then continue; fi
    case "$n" in /*) die "refusing an absolute path: $name" ;; esac
    case "$n" in *\\*) die "refusing a path with a backslash: $name" ;; esac
    case "/$n/" in /../* | */../* | */./*) die "refusing a path with .. or . parts: $name" ;; esac
    [ "$n" != "module.json" ] || has_module_json=1
    nfiles=$((nfiles + 1))
  done <"$work/names"
  [ "$has_module_json" = 1 ] || die "the zip has no module.json at its top level"
  total="$(unzip -Zt "$zip" | awk 'NR==1{print $3}')"
  [[ "$total" =~ ^[0-9]+$ ]] || die "cannot read the unpacked size of the zip"
  [ "$total" -le "$MAX_ZIP_BYTES" ] || die "the zip unpacks to $total bytes, over the $MAX_ZIP_BYTES limit"
  free_import="$(df --output=avail -B1 "$IMPORT" | tail -n1 | tr -d ' ')"
  free_data="$(df --output=avail -B1 "$FOUNDRY_DATA" | tail -n1 | tr -d ' ')"
  if [ "$free_import" -le $((total * 3)) ] || [ "$free_data" -le $((total * 3)) ]; then
    die "not enough free space for $total bytes (three times is needed in $IMPORT and $FOUNDRY_DATA)"
  fi
  ok "$nfiles entries, $total bytes, only files and folders, all inside the module folder"

  say "extracting and checking module.json"
  install -d -m 700 "$work/extract"
  unzip -q "$zip" -d "$work/extract" || die "extracting failed"
  stray="$(find "$work/extract" ! -type f ! -type d | head -n 3)"
  [ -z "$stray" ] || die "the extracted tree holds links or special files: $stray"
  [ "$(json_field "$work/extract/module.json" id)" = "$MODULE_ID" ] || die "module.json id is not $MODULE_ID"
  got_version="$(json_field "$work/extract/module.json" version)"
  [ "$got_version" = "$STUDIO_VERSION" ] || die "module.json says version '$got_version', expected '$STUDIO_VERSION'"
  ok "module.json: $MODULE_ID $got_version"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$work/extract"
  find "$work/extract" -type d -exec chmod 755 {} +
  find "$work/extract" -type f -exec chmod 644 {} +
fi

# ---- stop, swap, settings ---------------------------------------------------------------------------------
if have_systemd; then
  # Remember what ran, so a failed run starts only that again.
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service && was_gm_browser=1
  say "stopping the Assistant GM browser and Foundry"
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  systemctl stop foundry.service
  stopped=1
fi

if [ "$need_install" = 1 ]; then
  say "installing Actor Studio $STUDIO_VERSION"
  install_state=1
  install -d -m 755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$data/modules"
  if [ -e "$studio_dir" ]; then
    install -d -m 700 "$prev" "$prev/modules"
    mv "$studio_dir" "$prev/modules/$MODULE_ID"
    ok "the old $MODULE_ID (${installed_version:-no version}) moved to $prev/modules/$MODULE_ID"
  fi
  mv "$work/extract" "$studio_dir"
  install_state=2
  ok "$MODULE_ID $STUDIO_VERSION installed in $studio_dir"
fi

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

world_settings() { # $1 world id: Foundry runs it, the GM's browser sets and verifies the settings
  local id="$1" envf="$TOOL_ETC/world-$1.env"
  say "player creation settings in $id"
  set_world "$id"
  systemctl start foundry.service
  wait_for_world "$id"
  ok "$id is running"
  (
    set -a
    # shellcheck disable=SC1090
    . "$envf"
    set +a
    [ -n "${GM_USER:-}" ] && [ -n "${GM_PASSWORD:-}" ] || {
      echo "ERROR: $envf has no GM_USER and GM_PASSWORD" >&2
      exit 1
    }
    # The login stays in the environment (exported by the sourced file), never on a command line.
    export WORLD="$id" HOME="$TOOL_DATA" TOOL_APP="$TOOL_DIR/app" FOUNDRY_URL=http://127.0.0.1:30000 CHROMIUM=/usr/bin/chromium
    runuser -u "$FOUNDRY_USER" -- node "$driver_dir/player-creation-settings.mjs"
  ) || die "the settings for $id failed or did not verify (see the lines above)"
  ok "$id: settings set and read back"
  systemctl stop foundry.service
}

if [ "$run_b" = 1 ]; then
  for id in "${worlds[@]}"; do world_settings "$id"; done

  say "Foundry launches ${orig_world:-no world} again"
  set_world "$orig_world"
  ok "options.json launches ${orig_world:-no world}"
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  systemctl restart foundry.service
  if [ -n "$orig_world" ]; then
    wait_for_world "$orig_world"
    ok "$orig_world is running"
  fi
  enable_unit foundry-ai-tool-gm-browser.service
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
else
  warn "no systemd here (a test container?): part B was skipped, and Foundry and the Assistant GM browser were not touched"
fi

say "cleaning up"
stopped=0
trap - EXIT
rm -rf "${work:?}"
prev_note="nothing was replaced, so there is no prev folder"
if [ -d "$prev" ]; then
  prev_note="old copies kept in $prev ($(du -sh "$prev" | cut -f1)); remove them later, only with the user's OK"
fi

say "summary"
echo "    Actor Studio: $(json_field "$studio_dir/module.json" version) ($([ "$need_install" = 1 ] && echo installed || echo "already there, skipped"))"
if [ "$run_b" = 1 ]; then
  echo "    player creation settings set and verified in: ${worlds[*]}"
  echo "    Foundry launches: ${orig_world:-no world}"
else
  echo "    player creation settings: skipped (no systemd)"
fi
echo "    $prev_note"
