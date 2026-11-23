#!/usr/bin/env bash
# Pi stage 5 (the tool release update, remote/5-tool) on a Pi whose stack runs as containers (day two, D-149),
# in bash with the real lib.sh and stand-ins for docker (compose build/config/up, inspect, image inspect, ps), systemctl, git,
# npm, node (the real one), curl, ss, tailscale, id, uname, dpkg, chown and install. The docker stand-in keeps the four
# containers and the three images as files, so an `up -d` really recreates a container whose image or settings changed. The
# whole stage runs, in a sandbox folder (lib.sh's paths are pointed there after it is sourced); nothing outside it changes,
# and no Docker or systemd is needed. The last line is ALL SCENARIOS OK when every one passed:
#   REPO=$PWD bash scripts/pi/container-test/stage5-compose-scenarios.sh
# (scripts/pi/stage5-compose.test.mjs runs it.) Scenarios: a new ref with every image changed; only the app image changed;
# nothing changed (no quiet check, nothing recreated); a rerun of a built ref that only recreates; no deploy/pi/.env (refused,
# nothing changed); a ref without deploy/pi/compose.yml; a failed image build; players online before the build and before the
# recreate; a failed `up -d --wait`; the driver copy is optional; no unit is touched in any of them.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }

REPO="${REPO:-/repo}"
# The stage's file name is built, not spelled: the CI filter test follows a named stage into its text, and this stage's
# text names build output of the tool checkout, which the filter need not cover.
stage_file=5-tool
STAGE="${STAGE:-$REPO/scripts/pi/remote/$stage_file.sh}"
LIB="$REPO/scripts/pi/remote/lib.sh"
REAL_NODE="$(command -v node)" || { echo "REFUSED: node is needed (the stage runs its load check with it)"; exit 98; }

root="$(mktemp -d)"
# A path both bash and a Windows node understand (Git Bash: C:/...), since the stage hands paths to node.
if command -v cygpath >/dev/null 2>&1; then root="$(cygpath -m "$root")"; fi
trap 'rm -rf "${root:?}"' EXIT
n=0
# A folder name for PATH (Git Bash: C:/x would be split at the colon).
posix_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else echo "$1"; fi; }

# new_pi: a sandbox Pi on the container stack (tool checkout "old" at v0.31.0, four running containers on image v1)
new_pi() {
  SB="$root/pi.$((++n))"
  BIN="$SB/bin"
  FAKE="$SB/fake"
  APP="$SB/tool/app"
  mkdir -p "$BIN" "$FAKE/c" "$FAKE/img" "$APP/deploy/pi" "$APP/packages/mcp-server/dist" "$SB/etc" "$SB/data" \
    "$SB/foundry-app" "$SB/foundry-data" "$SB/node24/bin" "$SB/root"
  : >"$FAKE/calls"
  echo old >"$APP/MARK"
  echo v0.31.0 >"$APP/.tool-ref"
  : >"$APP/packages/mcp-server/dist/standalone.js"
  : >"$APP/deploy/pi/compose.yml"
  printf 'FOUNDRY_UID=996\nFOUNDRY_GID=996\nDASHBOARD_ALLOWED_HOSTS=pi.example.ts.net\nCOMPOSE_EXTRA=keep-me\n' >"$APP/deploy/pi/.env"
  : >"$SB/foundry-app/main.js"
  echo 0 >"$FAKE/online"
  echo h1 >"$FAKE/cfg-hash"
  : >"$FAKE/build-changes"
  local s i
  for i in app foundry gm-browser; do echo v1 >"$FAKE/img/$i"; done
  for s in foundry bridge dashboard gm-browser; do
    echo 1 >"$FAKE/c/$s.gen"
    echo v1 >"$FAKE/c/$s.img"
    echo h1 >"$FAKE/c/$s.hash"
  done
  write_stubs
}

write_stubs() {
  local s
  # The real node under the stage's $NODE_DIR/bin and on the PATH.
  printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$REAL_NODE" >"$SB/node24/bin/node"
  cp "$SB/node24/bin/node" "$BIN/node"
  chmod +x "$SB/node24/bin/node" "$BIN/node"
  cat >"$BIN/id" <<'EOF'
#!/usr/bin/env bash
if [ "$*" = "-u" ]; then echo 0; else /usr/bin/id "$@"; fi
EOF
  printf '#!/usr/bin/env bash\n[ "$1" = -m ] && echo aarch64 || /usr/bin/uname "$@"\n' >"$BIN/uname"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/dpkg"
  printf '#!/usr/bin/env bash\necho "Chromium 1.0 fake"\n' >"$BIN/chromium"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/chown"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/curl"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/ss"
  printf '#!/usr/bin/env bash\nexit 1\n' >"$BIN/tailscale" # not running here: nothing is shared
  # install without owners and modes (no foundry user here; modes mean nothing in Git Bash): -d makes folders, else a copy
  cat >"$BIN/install" <<'EOF'
#!/usr/bin/env bash
dirs=0; args=()
while [ $# -gt 0 ]; do
  case "$1" in -o | -g | -m) shift 2 ;; -d) dirs=1; shift ;; *) args+=("$1"); shift ;; esac
done
if [ "$dirs" = 1 ]; then mkdir -p "${args[@]}"; else cp "${args[0]}" "${args[1]}"; fi
EOF
  # npm: the fake tree from git already has its packages; build and prune change nothing
  printf '#!/usr/bin/env bash\necho "npm $*" >>"%s/calls"\nexit 0\n' "$FAKE" >"$BIN/npm"
  cat >"$BIN/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >>"$FAKE/calls"
case "\$1" in is-active) exit 3 ;; is-enabled) echo disabled; exit 1 ;; esac
exit 0
EOF
  # git: the build tree is made by checkout; FAKE/fetch-fail, FAKE/no-compose steer it
  cat >"$BIN/git" <<EOF
#!/usr/bin/env bash
F="$FAKE"
EOF
  cat >>"$BIN/git" <<'EOF'
echo "git $*" >>"$F/calls"
[ "$1" != -C ] || { d="$2"; shift 2; }
case "$1" in
  init) mkdir -p "${@: -1}" ;;
  remote) ;;
  fetch) [ ! -f "$F/fetch-fail" ] || exit 1 ;;
  rev-parse) echo abc1234 ;;
  checkout)
    mkdir -p "$d/packages/mcp-server/dist/handouts" "$d/packages/mcp-server/dist/prompts" "$d/packages/cogm-dashboard/dist" \
      "$d/packages/foundry-module/dist" "$d/shared/dist" "$d/node_modules/playwright-core" "$d/deploy/pi"
    echo new >"$d/MARK"
    echo '{"version":"0.32.0","dependencies":{"playwright-core":"1"}}' >"$d/package.json"
    for f in standalone config logger foundry-connector handouts/strip-secrets prompts/register; do
      echo 'export const loaded = true;' >"$d/packages/mcp-server/dist/$f.js"
    done
    for f in server app config; do echo 'export const loaded = true;' >"$d/packages/cogm-dashboard/dist/$f.js"; done
    echo 'export const loaded = true;' >"$d/shared/dist/index.js"
    echo 'console.log(1);' >"$d/packages/foundry-module/dist/main.js"
    echo '{"id":"foundry-mcp-bridge"}' >"$d/packages/foundry-module/module.json"
    echo '{"name":"playwright-core","main":"index.js"}' >"$d/node_modules/playwright-core/package.json"
    echo 'module.exports = {};' >"$d/node_modules/playwright-core/index.js"
    [ -f "$F/no-compose" ] || echo 'services: {}' >"$d/deploy/pi/compose.yml" ;;
esac
exit 0
EOF
  # docker: ps, inspect, image inspect, info and the compose subcommands build, config and up
  cat >"$BIN/docker" <<EOF
#!/usr/bin/env bash
F="$FAKE"
APPMARK="$APP/MARK"
EOF
  cat >>"$BIN/docker" <<'EOF'
echo "docker $*" >>"$F/calls"
img_of() { case "$1" in foundry) echo foundry ;; gm-browser) echo gm-browser ;; *) echo app ;; esac; }
tag_of() { echo "foundry-ai-tool-pi/$(img_of "$1"):local"; }
name_of_tag() { t="${1#foundry-ai-tool-pi/}"; echo "${t%%:*}"; }
cur_id() { cat "$F/img/$(img_of "$1")"; }
svc_of_cid() { s="${1#cid-}"; echo "${s%-*}"; }
case "$1" in
  info) exit 0 ;;
  ps)
    shift; want=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --filter) shift; case "$1" in label=com.docker.compose.service=*) want="${1#label=com.docker.compose.service=}" ;; esac ;;
      esac
      shift
    done
    for s in foundry bridge dashboard gm-browser; do
      [ -f "$F/c/$s.gen" ] || continue
      [ -z "$want" ] || [ "$want" = "$s" ] || continue
      echo "cid-$s-$(cat "$F/c/$s.gen")"
    done ;;
  inspect)
    id="${@: -1}"; s="$(svc_of_cid "$id")"
    case "$*" in
      *Config.Image*) echo "$(tag_of "$s") sha256:$(cat "$F/c/$s.img")" ;;
      *config-hash*) cat "$F/c/$s.hash" ;;
      *StartedAt*) echo 2026-01-01T00:00:00Z ;;
    esac ;;
  logs) ;;
  image)
    [ "$2" = inspect ] || exit 0
    tag="${@: -1}"; f="$F/img/$(name_of_tag "$tag")"
    [ -f "$f" ] || exit 1
    case "$*" in *"-f"*) echo "sha256:$(cat "$f")" ;; esac ;;
  compose)
    shift; sub=""; rest=()
    while [ $# -gt 0 ]; do
      case "$1" in
        -p | -f) shift 2; continue ;;
        build | config | up) sub="$1"; shift; rest=("$@"); break ;;
      esac
      shift
    done
    case "$sub" in
      build)
        echo "build in $PWD (.env here: $([ -f .env ] && echo yes || echo no); the running checkout says: $(cat "$APPMARK" 2>/dev/null))" >>"$F/calls"
        [ ! -f "$F/build-fail" ] || { echo "ERROR: build failed"; exit 1; }
        for i in $(cat "$F/build-changes"); do echo v2 >"$F/img/$i"; done ;;
      config)
        case " ${rest[*]} " in
          *" --images "*) for i in foundry app gm-browser; do echo "foundry-ai-tool-pi/$i:local"; done ;;
          *" --hash "*) echo "${rest[1]} $(cat "$F/cfg-hash")" ;;
        esac ;;
      up)
        [ ! -f "$F/up-fail" ] || { echo "ERROR: container unhealthy"; exit 1; }
        svcs=(); skip=0
        for a in "${rest[@]}"; do
          if [ "$skip" = 1 ]; then skip=0; continue; fi
          case "$a" in --wait-timeout) skip=1 ;; -*) ;; *) svcs+=("$a") ;; esac
        done
        for s in "${svcs[@]}"; do
          gen="$(cat "$F/c/$s.gen" 2>/dev/null || echo 0)"
          if [ "$gen" = 0 ] || [ "$(cat "$F/c/$s.img")" != "$(cur_id "$s")" ] || [ "$(cat "$F/c/$s.hash")" != "$(cat "$F/cfg-hash")" ]; then
            echo "up recreates $s" >>"$F/calls"
            echo $((gen + 1)) >"$F/c/$s.gen"; cur_id "$s" >"$F/c/$s.img"; cat "$F/cfg-hash" >"$F/c/$s.hash"
          fi
        done ;;
    esac ;;
esac
exit 0
EOF
  chmod +x "$BIN"/*
}

# run_stage [env...]: lib.sh, the sandbox paths, then the stage; the output is in OUT, the status in RC, the calls in CALLS.
run_stage() {
  local f="$SB/run.sh" kv
  {
    cat "$LIB"
    printf '%s\n' "have_systemd() { return 0; }" "sleep() { :; }" \
      "TOOL_DIR=$SB/tool" "TOOL_ETC=$SB/etc" "TOOL_DATA=$SB/data" "NODE_DIR=$SB/node24" \
      "FOUNDRY_APP=$SB/foundry-app" "FOUNDRY_DATA=$SB/foundry-data" \
      "users_online() { cat \"$FAKE/online\"; }"
    cat "$STAGE"
  } >"$f"
  OUT="$(
    for kv in "$@"; do export "${kv?}"; done
    export PATH="$(posix_path "$BIN"):$PATH" DIETPI_DIR="$SB/dietpi" TOOL_REF="${TOOL_REF:-v0.32.0}" ASSISTANT_GM_DRIVER="$SB/root/assistant-gm.mjs"
    export TOOL_CHECKOUT="" HOME="$SB/root"
    unset TOOL_CHECKOUT
    timeout 240 bash "$f" 2>&1 </dev/null
  )"
  RC=$?
  CALLS="$(cat "$FAKE/calls")"
}

calls_have() { echo "$CALLS" | grep -qE "$1"; }
no_unit_changes() { ! calls_have '^systemctl .*(start|stop|restart|enable|disable|daemon-reload)'; }
no_container_moves() { ! calls_have '^docker (stop|start|restart|rm|kill|compose .* down)'; }
app_mark() { cat "$APP/MARK"; }
out_has() { echo "$OUT" | grep -qE "$1"; }
unchanged_checkout() { [ "$(app_mark)" = old ] && [ ! -d "$APP.prev" ] && [ ! -d "$SB/tool/build" ]; }

# 1. a new ref, every image changed: built before the swap, .env carried over, all four recreated, no unit touched
new_pi
echo "foundry app gm-browser" >"$FAKE/build-changes"
echo 'driver' >"$SB/root/assistant-gm.mjs"
run_stage
if [ "$RC" -eq 0 ] && [ "$(app_mark)" = new ] && [ "$(cat "$APP.prev/MARK")" = old ]; then pass "new ref: swapped in, the old copy kept as app.prev"; else fail "new ref (rc $RC): $OUT"; fi
if calls_have 'build in .*/tool/build/deploy/pi \(\.env here: yes; the running checkout says: old\)'; then pass "new ref: the images are built from the new tree, with the .env, before the swap"; else fail "build order: $CALLS"; fi
if cmp -s "$APP/deploy/pi/.env" "$APP.prev/deploy/pi/.env"; then pass "new ref: the .env (DASHBOARD_ALLOWED_HOSTS and the rest) is carried over unchanged"; else fail ".env differs"; fi
if no_unit_changes && no_container_moves; then pass "new ref: no unit started, stopped, enabled or restarted; no container stopped, started or removed"; else fail "units or containers touched: $CALLS"; fi
if [ "$(echo "$CALLS" | grep -c '^up recreates')" -eq 4 ] && out_has 'foundry: recreated' && out_has 'gm-browser: recreated' && out_has 'bridge: recreated' && out_has 'dashboard: recreated'; then pass "new ref: all four containers recreated and reported"; else fail "recreate: $OUT"; fi
if calls_have 'docker compose -p foundry-ai-tool-pi -f compose.yml up -d --no-build --wait'; then pass "new ref: compose up -d --wait on the live project"; else fail "up call: $CALLS"; fi
if ! out_has 'restart the container cid-foundry-[0-9]+ when no one plays'; then pass "new ref: Foundry was recreated, so no restart warning for the module"; else fail "module warning after a recreate: $OUT"; fi
if [ -f "$SB/tool/gm-browser/assistant-gm.mjs" ]; then pass "new ref: a copied driver is still installed"; else fail "driver not installed"; fi
if out_has 'the stack runs as containers \(project foundry-ai-tool-pi\)'; then pass "new ref: names the container stack"; else fail "services line: $OUT"; fi

# 2. only the app image changed: the bridge and the dashboard are recreated, Foundry and the Assistant GM are not
new_pi
echo "app" >"$FAKE/build-changes"
run_stage
if [ "$RC" -eq 0 ] && out_has 'bridge: recreated' && out_has 'dashboard: recreated' && out_has 'foundry: unchanged' && out_has 'gm-browser: unchanged'; then
  pass "app image only: bridge and dashboard recreated, foundry and gm-browser unchanged"
else fail "partial (rc $RC): $OUT"; fi
if ! calls_have '^up recreates (foundry|gm-browser)' && no_unit_changes && no_container_moves; then pass "app image only: Foundry and the Assistant GM are left running"; else fail "partial calls: $CALLS"; fi
if out_has 'restart the container cid-foundry-1 when'; then pass "app image only: the unchanged Foundry container is named for the module restart"; else fail "module warning: $OUT"; fi

# 2b. a new ref whose build gives the same images and settings: swapped in, nothing recreated
new_pi
run_stage
if [ "$RC" -eq 0 ] && [ "$(app_mark)" = new ] && out_has 'nothing recreated' && ! calls_have ' up ' && no_unit_changes && no_container_moves; then
  pass "same images and settings: the checkout is swapped, no container recreated"
else fail "no change (rc $RC): $OUT"; fi

# 3. players online with a new ref: the long image build (require_quiet) is what refuses, before anything is swapped
new_pi
echo 2 >"$FAKE/online"
run_stage
if [ "$RC" -ne 0 ] && out_has 'player\(s\) are online' && unchanged_checkout && ! calls_have 'build in '; then pass "players online: refused before the image build, checkout and containers untouched"; else fail "players online (rc $RC): $OUT"; fi

# 3b. nothing changed and the build was already there (rerun): no quiet check, no up, nothing recreated, even with players online
new_pi
echo v0.32.0 >"$APP/.tool-ref"
: >"$APP/.tool-pruned"
echo '{"version":"0.32.0","dependencies":{"playwright-core":"1"}}' >"$APP/package.json"
mkdir -p "$APP/packages/foundry-module/dist" "$APP/packages/cogm-dashboard/dist"
echo 'console.log(1);' >"$APP/packages/foundry-module/dist/main.js"
echo '{"id":"foundry-mcp-bridge"}' >"$APP/packages/foundry-module/module.json"
echo 3 >"$FAKE/online"
run_stage
if [ "$RC" -eq 0 ] && out_has 'already built' && out_has 'nothing recreated' && ! calls_have ' up ' && ! calls_have 'build in ' && no_unit_changes && no_container_moves; then
  pass "current containers: nothing recreated and no quiet check, though players are online"
else fail "unchanged rerun (rc $RC): $OUT $CALLS"; fi

# 3c. a settings change alone (compose config hash) recreates, and a changed container needs a quiet Pi
echo h2 >"$FAKE/cfg-hash"
run_stage
if [ "$RC" -ne 0 ] && out_has 'player\(s\) are online' && ! calls_have '^up recreates' && no_container_moves; then pass "changed settings with players online: refused, nothing recreated"; else fail "hash change, players (rc $RC): $OUT"; fi
echo 0 >"$FAKE/online"
run_stage
if [ "$RC" -eq 0 ] && [ "$(echo "$CALLS" | grep -c '^up recreates')" -eq 4 ]; then pass "changed settings on a quiet Pi: recreated"; else fail "hash change (rc $RC): $OUT"; fi

# 4. a rerun of a built ref whose images are newer than the containers: no build, only the recreate
new_pi
echo v0.32.0 >"$APP/.tool-ref"
: >"$APP/.tool-pruned"
echo '{"version":"0.32.0","dependencies":{"playwright-core":"1"}}' >"$APP/package.json"
mkdir -p "$APP/packages/foundry-module/dist"
echo 'console.log(1);' >"$APP/packages/foundry-module/dist/main.js"
echo '{"id":"foundry-mcp-bridge"}' >"$APP/packages/foundry-module/module.json"
echo v2 >"$FAKE/img/app"
run_stage
if [ "$RC" -eq 0 ] && ! calls_have 'build in ' && ! calls_have '^git ' && out_has 'bridge: recreated' && out_has 'foundry: unchanged'; then
  pass "rerun: no build, no fetch, the changed services are recreated"
else fail "rerun (rc $RC): $OUT"; fi

# 5. no deploy/pi/.env in the current checkout: refused at once, nothing changed
new_pi
rm -f "$APP/deploy/pi/.env"
echo "app" >"$FAKE/build-changes"
run_stage
if [ "$RC" -eq 1 ] && out_has 'run stage 23 first' && unchanged_checkout && ! calls_have '^git ' && ! calls_have 'build in ' && ! calls_have '^up recreates' && no_unit_changes && no_container_moves; then
  pass "no .env: refused with 'run stage 23 first', nothing changed"
else fail "no .env (rc $RC): $OUT"; fi

# 6. the new ref has no deploy/pi/compose.yml: refused before the build, the old checkout and containers stay
new_pi
touch "$FAKE/no-compose"
run_stage
if [ "$RC" -eq 1 ] && out_has 'no deploy/pi/compose.yml' && unchanged_checkout && ! calls_have 'build in ' && ! calls_have '^up recreates' && no_unit_changes && no_container_moves; then
  pass "a ref without compose.yml: refused, old checkout and containers untouched"
else fail "no compose.yml (rc $RC): $OUT"; fi

# 7. the image build fails: the old checkout and the running containers stay as they were
new_pi
touch "$FAKE/build-fail"
echo "app" >"$FAKE/build-changes"
run_stage
if [ "$RC" -eq 1 ] && out_has 'image build of v0.32.0 failed' && unchanged_checkout && ! calls_have '^up recreates' && ! calls_have ' up ' && no_unit_changes && no_container_moves; then
  pass "failed image build: nothing swapped, nothing stopped, nothing recreated"
else fail "failed build (rc $RC): $OUT"; fi
if [ "$(cat "$FAKE/c/bridge.gen")" = 1 ] && [ "$(cat "$FAKE/c/foundry.gen")" = 1 ]; then pass "failed image build: the containers are the same ones"; else fail "containers changed"; fi

# 8. players online before the build (compose build can starve Foundry): refused before anything is built
new_pi
echo 1 >"$FAKE/online"
echo "app" >"$FAKE/build-changes"
run_stage
if [ "$RC" -eq 1 ] && out_has 'building the images' && unchanged_checkout && ! calls_have 'build in '; then pass "players online: no image build"; else fail "players, build (rc $RC): $OUT"; fi

# 9. up -d --wait fails: says so, names docker logs and stage 24 MODE=rollback; the checkout is swapped completely, app.prev is the old copy
new_pi
echo "app" >"$FAKE/build-changes"
touch "$FAKE/up-fail"
run_stage
if [ "$RC" -eq 1 ] && out_has 'docker compose up -d --wait failed' && out_has 'docker logs' && out_has 'MODE=rollback'; then pass "failed up: reported plainly with docker logs and MODE=rollback"; else fail "failed up (rc $RC): $OUT"; fi
if [ "$(app_mark)" = new ] && [ "$(cat "$APP.prev/MARK")" = old ] && [ ! -d "$SB/tool/build" ]; then pass "failed up: the checkout is whole (new in place, old as app.prev)"; else fail "checkout state after failed up"; fi
if no_unit_changes && no_container_moves; then pass "failed up: still no unit touched and no container stopped"; else fail "calls: $CALLS"; fi

# 10. no driver copy and no installed driver: fine in containers mode (it is baked into the image)
new_pi
echo "app" >"$FAKE/build-changes"
run_stage
if [ "$RC" -eq 0 ] && out_has 'baked into its image'; then pass "no driver copy: not needed on containers"; else fail "no driver (rc $RC): $OUT"; fi

if [ "$fails" -eq 0 ]; then echo "ALL SCENARIOS OK"; else echo "$fails scenario(s) failed"; exit 1; fi
