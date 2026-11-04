#!/usr/bin/env bash
# Deployed-state check for the Orange Pi (backlog: pi-deployed-state-check). READ-ONLY: it changes nothing, so it
# runs without a snapshot or a stage review. From the PC:  deploy/pi/deployed-state.ps1   (or by hand:
#   ssh foundry-pi 'EXPECT_REF=v0.25.0 bash -s' < deploy/pi/deployed-state.sh )
#
# It reports, one line each ("ok:", "WARNING:", "FAIL:"), and exits 1 when anything FAILs:
#   containers  with Docker present: each container of the compose project, its health and restart count
#               (pi-docker-compose); once containers run, the systemd units must be retired (two copies = FAIL)
#   units       each systemd service active, its restart count, and a crash loop (decision 41)
#   env         names that a stage should have written, per env file (names only, never values)
#   packages    libicu (the GitHub runner), chromium, git
#   build       the deployed ref (stage 5's .tool-ref) against EXPECT_REF, the newest release tag, and the
#               Assistant GM helper against EXPECT_ASSISTANT_GM_SHA256 (deployed-state.ps1 fills both from the repo)
# Without EXPECT_* the build lines say what is deployed and nothing more.
#
# Paths and commands can be overridden by environment for the tests: TOOL_DIR, TOOL_ETC, COMPOSE_PROJECT, and
# SYSTEMCTL, DOCKER, LDCONFIG (command names looked up on PATH).

set -uo pipefail

TOOL_DIR="${TOOL_DIR:-/opt/foundry-ai-tool}"
TOOL_ETC="${TOOL_ETC:-/etc/foundry-ai-tool}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
DOCKER="${DOCKER:-docker}"
LDCONFIG="${LDCONFIG:-ldconfig}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-foundry-ai-tool-pi}"
# A restart count at or above this on a unit or container is a crash loop (decision 41).
LOOP_RESTARTS="${LOOP_RESTARTS:-5}"

n_ok=0
n_warn=0
n_fail=0
ok() { printf '    ok: %s\n' "$*"; n_ok=$((n_ok + 1)); }
warn() { printf '    WARNING: %s\n' "$*"; n_warn=$((n_warn + 1)); }
fail() { printf '    FAIL: %s\n' "$*"; n_fail=$((n_fail + 1)); }
say() { printf '==> %s\n' "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---- containers first: they decide which side of the cutover the units are on ---------------------------------
# After the compose cutover the systemd units stay installed but disabled, so a stopped unit is the expected state and
# a running unit next to its own running container is a port clash. Only containers of this compose project count
# (a GitHub runner's job containers must not show up here).
mode=systemd
running_services=" "

say "containers"
if have "$DOCKER"; then
  rows="$("$DOCKER" ps -a --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --format '{{.Names}}|{{.Label "com.docker.compose.service"}}' 2>/dev/null)" || rows=""
  if [ -z "$rows" ]; then
    ok "no containers in project $COMPOSE_PROJECT (the stack runs on systemd)"
  else
    mode=containers
    while IFS='|' read -r name service; do
      [ -n "$name" ] || continue
      line="$("$DOCKER" inspect -f '{{.State.Status}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null)" || line=""
      IFS='|' read -r state restarts health <<<"$line"
      [[ "$restarts" =~ ^[0-9]+$ ]] || restarts=0
      [ "$state" = running ] && running_services="$running_services$service "
      if [ "$state" = restarting ] || [ "$restarts" -ge "$LOOP_RESTARTS" ]; then
        fail "container $service is in a crash loop ($state, $restarts restarts)"
      elif [ "$state" != running ]; then
        fail "container $service is $state"
      elif [ "$health" = unhealthy ]; then
        fail "container $service is unhealthy"
      elif [ "$health" = none ]; then
        warn "container $service has no health check"
      elif [ "$health" != healthy ]; then
        warn "container $service health is $health"
      elif [ "$restarts" -gt 0 ]; then
        warn "container $service is healthy but restarted $restarts time(s)"
      else
        ok "container $service is running and healthy, no restarts"
      fi
    done <<<"$rows"
  fi
  # A rehearsal (stage 24 on other ports) is its own project and restarts with the daemon: never leave one behind.
  if [ -n "$("$DOCKER" ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT-rehearsal" 2>/dev/null)" ]; then
    warn "a rehearsal stack is present (project $COMPOSE_PROJECT-rehearsal): stage 24 MODE=down with the rehearsal ports stops it"
  fi
else
  ok "no Docker on this host (the stack runs on systemd)"
fi

# ---- units ---------------------------------------------------------------------------------------------------
check_unit() { # $1 unit name, $2 compose service it becomes, $3 "required" or "optional"
  local unit="$1" service="$2" need="$3" props active sub restarts
  props="$("$SYSTEMCTL" show "$unit" -p LoadState -p ActiveState -p SubState -p NRestarts 2>/dev/null)" || props=""
  if ! printf '%s\n' "$props" | grep -q '^LoadState=loaded'; then
    if [ "$mode" = containers ] || [ "$need" = optional ]; then ok "$unit is not installed"; else fail "$unit is not installed"; fi
    return
  fi
  active="$(printf '%s\n' "$props" | sed -n 's/^ActiveState=//p')"
  sub="$(printf '%s\n' "$props" | sed -n 's/^SubState=//p')"
  restarts="$(printf '%s\n' "$props" | sed -n 's/^NRestarts=//p')"
  [[ "$restarts" =~ ^[0-9]+$ ]] || restarts=0
  if [ "$mode" = containers ]; then
    case "$running_services" in
      *" $service "*)
        if [ "$active" = active ] || [ "$sub" = auto-restart ]; then
          fail "$unit is $active and the $service container is running too: two copies on the same ports"
        else
          ok "$unit is $active (retired; the $service container runs)"
        fi
        return
        ;;
    esac
    # No running container for it: judge the unit as on systemd (a rollback under way, or a stopped container).
  fi
  if [ "$sub" = auto-restart ] || [ "$restarts" -ge "$LOOP_RESTARTS" ]; then
    fail "$unit is in a crash loop ($active/$sub, $restarts restarts)"
  elif [ "$active" != active ]; then
    # A unit that is installed but stopped is expected for the Assistant GM during a kit session.
    if [ "$need" = required ] && [ "$mode" = systemd ]; then fail "$unit is $active ($sub)"; else warn "$unit is $active ($sub)"; fi
  elif [ "$restarts" -gt 0 ]; then
    warn "$unit is active but restarted $restarts time(s) since it started"
  else
    ok "$unit is active, no restarts"
  fi
}

say "units ($mode)"
if have "$SYSTEMCTL"; then
  check_unit foundry.service foundry required
  check_unit foundry-ai-tool-bridge.service bridge required
  check_unit foundry-ai-tool-dashboard.service dashboard required
  check_unit foundry-ai-tool-gm-browser.service gm-browser optional
else
  warn "no systemctl here: the units were not checked"
fi

# ---- env names -----------------------------------------------------------------------------------------------
# Names only. A line "NAME=" with nothing after it counts as missing.
env_has() { # $1 file, $2 extended regex of the name(s)
  [ -f "$1" ] && grep -Eq "^($2)=.+" "$1"
}
need_env() { # $1 file, $2 name regex, $3 level (fail|warn), $4 what breaks without it
  if [ ! -f "$1" ]; then
    $3 "$1 is missing ($4)"
  elif env_has "$1" "$2"; then
    ok "$(basename "$1") sets ${2//|/ or }"
  else
    $3 "$(basename "$1") has no ${2//|/ or } ($4)"
  fi
}

say "env (names only)"
need_env "$TOOL_ETC/dashboard.env" DASHBOARD_FOUNDRY_URL warn "the GM page cannot open Foundry, the Live window stays blank and the initiative ribbon shows initials; run stage 7 again with DASHBOARD_FOUNDRY_URL=https://play.<domain>"
need_env "$TOOL_ETC/dashboard.env" OBSIDIAN_VAULT_NAME warn "dashboard links into Obsidian stay off; run stage 7"
need_env "$TOOL_ETC/bridge.env" FOUNDRY_AI_OBSIDIAN_DIR warn "the Obsidian export has no folder; run stage 7"
need_env "$TOOL_ETC/bridge.env" FOUNDRY_AI_OPEN_BASE warn "'Open in Foundry' links stay off; run stage 7 with OPEN_BASE"
need_env "$TOOL_ETC/dashboard-access.env" 'GM_DASHBOARD_TOKEN|GM_EMAILS' warn "everyone who reaches port 3000 is treated as the GM and sees spoilers; run set-dashboard-access.sh"
if [ -f "$TOOL_ETC/assistant-gm.env" ]; then
  need_env "$TOOL_ETC/assistant-gm.env" ASSISTANT_GM_PASSWORD warn "the headless GM cannot log in"
else
  warn "$TOOL_ETC/assistant-gm.env is missing: the Assistant GM browser has no user (stage 5 check world / stage 11)"
fi

# ---- packages ------------------------------------------------------------------------------------------------
say "packages"
# Read the whole list first: grep -q quits at the first match, and under pipefail a real Pi's long
# `ldconfig -p` output would then end in SIGPIPE and read as "missing".
libs="$("$LDCONFIG" -p 2>/dev/null)" || libs=""
if grep -q 'libicuuc\.so' <<<"$libs"; then
  ok "libicu is installed"
else
  warn "libicu is missing: the GitHub runner (stage 17) stops without it"
fi
for cmd in chromium git; do
  if have "$cmd"; then ok "$cmd is installed"; else warn "$cmd is missing (stage 5 installs it)"; fi
done

# ---- build ---------------------------------------------------------------------------------------------------
# Stage 5 writes the ref it built to $TOOL_DIR/app/.tool-ref. The Pi runs release tags (D-126), so "main's build" is
# the newest vX.Y.Z tag: the wrapper passes it as EXPECT_REF and the count of main commits after it as
# EXPECT_MAIN_AHEAD. package.json's version is not compared: it only changes at a release, so a match proves nothing.
say "deployed build"
app="$TOOL_DIR/app"
if [ -f "$app/.tool-ref" ]; then
  have_ref="$(head -n 1 "$app/.tool-ref")"
  ahead=""
  [ -z "${EXPECT_MAIN_AHEAD:-}" ] || ahead="; main is ${EXPECT_MAIN_AHEAD} commit(s) past it"
  if [ -z "${EXPECT_REF:-}" ]; then
    ok "deployed ref is ${have_ref:-unknown} (no EXPECT_REF given)"
  elif [ "$have_ref" = "$EXPECT_REF" ]; then
    ok "deployed ref $have_ref is the newest release${ahead}"
  else
    warn "deployed ref is ${have_ref:-unknown}, the newest release is $EXPECT_REF${ahead}: deploy again (stage 5)"
  fi
elif [ -f "$app/package.json" ]; then
  warn "no $app/.tool-ref: the deployed ref is unknown (a build from before stage 5 wrote it)"
else
  fail "no build at $app (stage 5 has not run)"
fi
helper="$TOOL_DIR/gm-browser/assistant-gm.mjs"
if [ -f "$helper" ]; then
  have_sha="$(sha256sum "$helper" | awk '{print $1}')"
  if [ -z "${EXPECT_ASSISTANT_GM_SHA256:-}" ]; then
    ok "Assistant GM helper is $have_sha (no EXPECT_ASSISTANT_GM_SHA256 given)"
  elif [ "$have_sha" = "$EXPECT_ASSISTANT_GM_SHA256" ]; then
    ok "Assistant GM helper matches the repo copy"
  else
    warn "Assistant GM helper differs from the repo copy: copy scripts/pi/remote/assistant-gm.mjs and run stage 5 again"
  fi
else
  warn "no Assistant GM helper at $helper"
fi

printf 'deployed-state: %d ok, %d warning(s), %d failed\n' "$n_ok" "$n_warn" "$n_fail"
[ "$n_fail" -eq 0 ]
