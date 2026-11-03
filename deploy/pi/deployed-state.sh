#!/usr/bin/env bash
# Deployed-state check for the Orange Pi (backlog: pi-deployed-state-check). READ-ONLY: it changes nothing, so it
# runs without a snapshot or a stage review. From the PC:  deploy/pi/deployed-state.ps1   (or by hand:
#   ssh foundry-pi 'EXPECT_VERSION=0.25.0 bash -s' < deploy/pi/deployed-state.sh )
#
# It reports, one line each ("ok:", "WARNING:", "FAIL:"), and exits 1 when anything FAILs:
#   units       each systemd service active, its restart count, and a crash loop (decision 41)
#   containers  with Docker present: each container's health and restart count (pi-docker-compose)
#   env         names that a stage should have written, per env file (names only, never values)
#   packages    libicu (the GitHub runner), chromium, git
#   build       the deployed app's version against EXPECT_VERSION, and the Assistant GM helper against
#               EXPECT_ASSISTANT_GM_SHA256 (the deploy.ps1 wrapper fills both from the repo)
# Without EXPECT_* the build lines say what is deployed and nothing more.
#
# Paths and commands can be overridden by environment for the tests: TOOL_DIR, TOOL_ETC, FOUNDRY_USER, and
# SYSTEMCTL, DOCKER, LDCONFIG, DPKG_QUERY (command names looked up on PATH).

set -uo pipefail

TOOL_DIR="${TOOL_DIR:-/opt/foundry-ai-tool}"
TOOL_ETC="${TOOL_ETC:-/etc/foundry-ai-tool}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
DOCKER="${DOCKER:-docker}"
LDCONFIG="${LDCONFIG:-ldconfig}"
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

# ---- units ---------------------------------------------------------------------------------------------------
check_unit() { # $1 unit name, $2 "required" or "optional"
  local unit="$1" need="$2" props active sub restarts
  props="$("$SYSTEMCTL" show "$unit" -p LoadState -p ActiveState -p SubState -p NRestarts 2>/dev/null)" || props=""
  if ! printf '%s\n' "$props" | grep -q '^LoadState=loaded'; then
    [ "$need" = required ] && fail "$unit is not installed" || ok "$unit is not installed (optional)"
    return
  fi
  active="$(printf '%s\n' "$props" | sed -n 's/^ActiveState=//p')"
  sub="$(printf '%s\n' "$props" | sed -n 's/^SubState=//p')"
  restarts="$(printf '%s\n' "$props" | sed -n 's/^NRestarts=//p')"
  [[ "$restarts" =~ ^[0-9]+$ ]] || restarts=0
  if [ "$sub" = auto-restart ] || [ "$restarts" -ge "$LOOP_RESTARTS" ]; then
    fail "$unit is in a crash loop ($active/$sub, $restarts restarts)"
  elif [ "$active" != active ]; then
    # A unit that is installed but stopped is expected for the Assistant GM during a kit session.
    [ "$need" = required ] && fail "$unit is $active ($sub)" || warn "$unit is $active ($sub)"
  elif [ "$restarts" -gt 0 ]; then
    warn "$unit is active but restarted $restarts time(s) since it started"
  else
    ok "$unit is active, no restarts"
  fi
}

say "units"
if have "$SYSTEMCTL"; then
  check_unit foundry.service required
  check_unit foundry-ai-tool-bridge.service required
  check_unit foundry-ai-tool-dashboard.service required
  check_unit foundry-ai-tool-gm-browser.service optional
else
  warn "no systemctl here: the units were not checked"
fi

# ---- containers ----------------------------------------------------------------------------------------------
say "containers"
if have "$DOCKER"; then
  names="$("$DOCKER" ps -a --format '{{.Names}}' 2>/dev/null)" || names=""
  if [ -z "$names" ]; then
    ok "no containers (the stack still runs on systemd)"
  else
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      line="$("$DOCKER" inspect -f '{{.State.Status}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null)" || line=""
      IFS='|' read -r state restarts health <<<"$line"
      [[ "$restarts" =~ ^[0-9]+$ ]] || restarts=0
      if [ "$state" = restarting ] || [ "$restarts" -ge "$LOOP_RESTARTS" ]; then
        fail "container $name is in a crash loop ($state, $restarts restarts)"
      elif [ "$state" != running ]; then
        fail "container $name is $state"
      elif [ "$health" = unhealthy ]; then
        fail "container $name is unhealthy"
      elif [ "$health" = none ]; then
        warn "container $name has no health check"
      elif [ "$health" != healthy ]; then
        warn "container $name health is $health"
      elif [ "$restarts" -gt 0 ]; then
        warn "container $name is healthy but restarted $restarts time(s)"
      else
        ok "container $name is running and healthy, no restarts"
      fi
    done <<<"$names"
  fi
else
  ok "no Docker on this host (the stack runs on systemd)"
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
if "$LDCONFIG" -p 2>/dev/null | grep -q 'libicuuc\.so'; then
  ok "libicu is installed"
else
  warn "libicu is missing: the GitHub runner (stage 17) stops without it"
fi
for cmd in chromium git; do
  if have "$cmd"; then ok "$cmd is installed"; else warn "$cmd is missing (stage 5 installs it)"; fi
done

# ---- build ---------------------------------------------------------------------------------------------------
say "deployed build"
pkg="$TOOL_DIR/app/package.json"
if [ -f "$pkg" ]; then
  have_version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$pkg" | head -n 1)"
  if [ -z "${EXPECT_VERSION:-}" ]; then
    ok "deployed version is ${have_version:-unknown} (no EXPECT_VERSION given)"
  elif [ "$have_version" = "$EXPECT_VERSION" ]; then
    ok "deployed version $have_version is the one expected"
  else
    warn "deployed version is ${have_version:-unknown}, main has $EXPECT_VERSION: deploy again (stage 5)"
  fi
else
  fail "no build at $TOOL_DIR/app (stage 5 has not run)"
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
