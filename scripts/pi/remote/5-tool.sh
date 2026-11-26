#!/usr/bin/env bash
# Stage 5: the Foundry AI Tool on the Pi. The bridge and the co-GM dashboard run as services, the
# Foundry module goes into Foundry's data folder, and a headless Chromium stays logged into
# Foundry as the "Assistant GM" user, so the module's link to the bridge runs with no human GM
# online (the module's "bridge user" setting names that user).
# Claude copies the browser driver first:  scp scripts/pi/remote/assistant-gm.mjs foundry-pi:/root/
# then runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/5-tool.sh | ssh foundry-pi 'bash -s'
# TOOL_REF picks the git tag, branch or commit to build. Without it the stage builds the newest release tag
# (vX.Y.Z, found with git ls-remote), never main: game nights run a known version (D-126; docs/dev/RELEASING.md).
# Everything listens on loopback only; Tailscale serve shares the control port (31414) and the dashboard (3000) with the
# tailnet, never with the home network or the internet. The bridge's control port has no login of
# its own (vault idea I-023).
#
# Containers (day two, D-149): after the cutover (stage 24) the stack runs as containers and this stage updates it too.
# The host build is the same (the checkout also feeds the kit session and the module). It needs deploy/pi/.env in the
# current checkout (else: run stage 23 first, nothing changed), carries that file into the new build tree, and builds the
# images from the new tree BEFORE the swap (behind require_quiet), so a failed image build leaves the running containers and
# the old checkout alone. Nothing is stopped for the swap (the containers run baked images), and no unit file is written or
# enabled. After the swap `docker compose up -d --wait` recreates only the services whose image or settings changed, after
# require_quiet; a run that finds everything current recreates nothing and needs no quiet Pi. A new module still needs a
# Foundry restart: the stage warns and names the container to restart.

require_root
require_recent_snapshot
use_stack "stage 5 (the tool)"
require_arm64
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
[ -f "$FOUNDRY_APP/main.js" ] || die "Foundry is missing: run stage 3 first"
# On the container stack the compose settings file is what the new build is built and started with.
if [ "$STACK" = containers ] && [ ! -f "$(stack_dir)/.env" ]; then
  die "the stack runs as containers but $(stack_dir)/.env is missing: run stage 23 first (it writes the compose settings). Nothing was changed"
fi

ref="${TOOL_REF:-}"
repo="${TOOL_REPO:-https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git}"
app="$TOOL_DIR/app"
driver_src="${ASSISTANT_GM_DRIVER:-/root/assistant-gm.mjs}"
driver_dir="$TOOL_DIR/gm-browser"
module_dir="$FOUNDRY_DATA/Data/modules/foundry-mcp-bridge"
export PATH="$NODE_DIR/bin:$PATH"

say "packages"
apt_install git ca-certificates chromium fonts-liberation
ok "$(chromium --version 2>/dev/null || echo 'chromium installed')"

# True when the build in $1 lists playwright-core as a dependency, which is what lets the stage drop the dev packages
# (the Assistant GM driver and stages 11 and 13 load it from the build); older tags such as v0.21.0 list it as a
# dev package, so their build keeps every package.
tool_prunable() {
  (cd "$1" && node -e 'process.exit(require("./package.json").dependencies?.["playwright-core"] ? 0 : 1)')
}

# Loads one side-effect-free module of each package from the build in $1 (the bridge, the dashboard app, the shared
# package and the Discord recorder), so a runtime package the prune took away stops the stage before any service
# stops, not as a restart loop after the swap (#310 review M1). Nothing is started: the entry files (standalone.js,
# server.js) listen on import and are not touched, and a module that leaves a timer, a socket or a child process
# running after its import fails the check too. A listed file this ref does not have is skipped; a package with none
# left fails (a ref without packages/discord-bot has no Discord group). The failures go to stderr, one line each; a run
# that takes longer than LOAD_CHECK_TIMEOUT seconds (120) says "timed out".
check_build_loads() {
  local rc=0
  (cd "$1" && timeout "${LOAD_CHECK_TIMEOUT:-120}" node --input-type=module -e '
    import { existsSync } from "node:fs";
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    const groups = {
      bridge: ["config.js", "logger.js", "foundry-connector.js", "handouts/strip-secrets.js", "prompts/register.js"].map(f => "packages/mcp-server/dist/" + f),
      dashboard: ["app.js", "config.js"].map(f => "packages/cogm-dashboard/dist/" + f),
      shared: ["shared/dist/index.js"],
    };
    if (existsSync("packages/discord-bot/package.json")) groups.discord = ["packages/discord-bot/dist/rec/voice.js"];
    let failed = false;
    for (const [group, files] of Object.entries(groups)) {
      const present = files.filter(f => existsSync(f));
      if (present.length === 0) {
        console.error(`${group}: none of ${files.join(", ")} exists`);
        failed = true;
      }
      for (const f of present) {
        try {
          await import(pathToFileURL(path.resolve(f)).href);
        } catch (e) {
          console.error(`${group}: ${f}: ${String(e && e.message).split("\n")[0]}`);
          failed = true;
        }
      }
    }
    // Only the stdio handles may be open now: anything else (a timer, a socket, a child) was started by an import.
    const extra = process.getActiveResourcesInfo().filter(r => r !== "TTYWrap" && r !== "PipeWrap");
    if (extra.length > 0) {
      console.error(`after the imports still running: ${[...new Set(extra)].join(", ")} (a module starts something on import)`);
      failed = true;
    }
    process.exit(failed ? 1 : 0);
  ') || rc=$?
  if [ "$rc" = 124 ]; then
    echo "the load check timed out after ${LOAD_CHECK_TIMEOUT:-120} seconds (a module that does not finish loading?)" >&2
  fi
  return "$rc"
}

# ---- Containers (day two) ----------------------------------------------------------------------------------------

# containers_prepare_build TREE REF: before anything is swapped, in containers mode. The new tree must carry the container
# stack (deploy/pi/compose.yml); the current deploy/pi/.env (switches, ports, DASHBOARD_ALLOWED_HOSTS) is copied into it, and the
# images are built from it. A failed build dies here: the running containers and the old checkout are as they were.
containers_prepare_build() {
  local tree="$1" ref="$2" build_log="$TOOL_DIR/docker-build.log" images img
  [ -f "$tree/deploy/pi/compose.yml" ] ||
    die "$ref has no deploy/pi/compose.yml (a release from before the container stack), and the stack runs as containers; nothing was changed, the containers and $app are as they were"
  cp -p "$(stack_dir)/.env" "$tree/deploy/pi/.env"
  ok "$(stack_dir)/.env carried into the new build"
  require_quiet "building the images (a long build can starve Foundry)"
  say "building the images from the new tree, a few minutes (log: $build_log)"
  # COMPOSE_PROFILES=discord-bot: the recorder bot's image is built and recreated like the others (its service starts only
  # once stage 24 MODE=bot moved the bot into the stack; a profiled service is skipped by `compose build` otherwise).
  if ! (cd "$tree/deploy/pi" && COMPOSE_PROFILES=discord-bot docker compose -p "$COMPOSE_LIVE_PROJECT" -f compose.yml build) >"$build_log" 2>&1; then
    tail -n 40 "$build_log" >&2
    die "the image build of $ref failed (full log: $build_log); nothing was swapped or stopped, the containers and $app are as they were"
  fi
  images="$(cd "$tree/deploy/pi" && COMPOSE_PROFILES=discord-bot docker compose -p "$COMPOSE_LIVE_PROJECT" -f compose.yml config --images 2>/dev/null || true)"
  for img in $images; do
    docker image inspect "$img" >/dev/null 2>&1 ||
      die "image $img is missing after the build (log: $build_log); nothing was swapped or stopped"
  done
  ok "the images are built"
  # The build took minutes: ask for a quiet Pi again now, before the swap, when the apply below will recreate anything, so a
  # player who joined meanwhile refuses here and not half way (after the swap and the module copy).
  for img in $STACK_SERVICES; do
    if containers_stale "$img" "$tree"; then
      require_quiet "recreating the changed containers (checked before the swap)"
      break
    fi
  done
}

# containers_stale SERVICE [TREE]: TREE is the checkout whose compose config is the wanted one (before the swap that is the new
# build, not the deployed one); without it the deployed checkout counts. 0 when `compose up -d` would recreate the running container of SERVICE (its image is not the one the
# tag points to now, or its compose config hash is not the current one), or when that cannot be told (then the quiet check is
# asked for, which is the safe side). 1 when it is current, and also when the service has no container (stage 24 makes those).
containers_stale() {
  local cid img have want label now
  cid="$(svc_cid "$1" -a)"
  [ -n "$cid" ] || return 1
  read -r img have <<<"$(docker inspect -f '{{.Config.Image}} {{.Image}}' "$cid" 2>/dev/null || true)"
  [ -n "${img:-}" ] && [ -n "${have:-}" ] || return 0
  want="$(docker image inspect -f '{{.Id}}' "$img" 2>/dev/null || true)"
  [ -n "$want" ] && [ "$want" = "$have" ] || return 0
  label="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$cid" 2>/dev/null || true)"
  now="$(TOOL_CHECKOUT="${2:-${TOOL_CHECKOUT:-}}" stack_compose config --hash "$1" 2>/dev/null | awk 'NR == 1 { print $NF }' || true)"
  [ -n "$label" ] && [ -n "$now" ] && [ "$label" = "$now" ] || return 0
  return 1
}

# containers_apply: recreates the containers whose image or settings changed, and only those (compose decides which), after
# require_quiet. Nothing changed: nothing recreated, no quiet check. Reports each service as recreated or unchanged.
containers_apply() {
  local s stale=0 present="" out after
  declare -A before
  for s in $STACK_SERVICES; do
    before[$s]="$(svc_cid "$s" -a)"
    [ -z "${before[$s]}" ] || present="$present $s"
    if containers_stale "$s"; then stale=1; fi
  done
  if [ "$stale" = 0 ]; then
    ok "the containers already run this build and these settings: nothing recreated"
    return 0
  fi
  require_quiet "recreating the changed containers"
  say "recreating the changed containers (docker compose up -d --wait)"
  # --no-build: the images were built before the swap. compose recreates only the services whose image or config changed.
  # shellcheck disable=SC2086
  if ! out="$(stack_compose up -d --no-build --wait --wait-timeout 300 $present 2>&1)"; then
    printf '%s\n' "$out" | tail -n 40 >&2
    die "docker compose up -d --wait failed: some containers may be recreated, some not. Look at the logs ($(svc_logs_hint bridge)); to go back to the systemd units run stage 24 with MODE=rollback. The new build stays in $app (the old copy is $app.prev if this run swapped one in)"
  fi
  for s in $STACK_SERVICES; do
    after="$(svc_cid "$s" -a)"
    if [ -z "${before[$s]}" ] && [ "$s" = discord-bot ]; then
      ok "$s: no container (the bot still runs as its systemd unit; stage 24 MODE=bot moves it, stage 8 updates the unit)"
    elif [ -z "${before[$s]}" ]; then
      ok "$s: no container (stage 24 makes it)"
    elif [ "$after" != "${before[$s]}" ]; then
      ok "$s: recreated"
      [ "$s" != foundry ] || foundry_recreated=1
    else
      ok "$s: unchanged"
    fi
  done
}

if [ -z "$ref" ]; then
  # Newest release tag by version, not by date; only plain vX.Y.Z (no -rc or other suffixes).
  tags="$(git ls-remote --tags --refs "$repo" 'v*')" || die "cannot list the tags of $repo (network?)"
  ref="$(printf '%s\n' "$tags" | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)"
  [ -n "$ref" ] || die "no release tag (vX.Y.Z) found in $repo: tag a release first, or set TOOL_REF"
  # v0.21.0 and older are behind what the Pi runs (no pruned build, no dashboard access env): never default to them.
  min_tag=v0.22.0
  [ "$(printf '%s\n%s\n' "$min_tag" "$ref" | sort -V | head -n 1)" = "$min_tag" ] ||
    die "the newest release tag is $ref, older than $min_tag: tag $min_tag first, or set TOOL_REF"
  if [ -f "$app/.tool-ref" ]; then
    cur="$(cat "$app/.tool-ref")"
    if printf '%s' "$cur" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
      [ "$(printf '%s\n%s\n' "$cur" "$ref" | sort -V | head -n 1)" = "$cur" ] ||
        die "$app runs $cur, newer than the newest release tag $ref: set TOOL_REF to go back on purpose"
    elif [ "$cur" != "$ref" ]; then
      warn "$app runs $cur (not a release tag); building $ref over it"
    fi
  fi
  ok "no TOOL_REF: building the newest release tag, $ref"
fi
say "the tool at $ref"
prev_ref="$(cat "$app/.tool-ref" 2>/dev/null || true)"
# The same ref is not built again, unless its build still has the dev packages although this stage can drop them
# (an earlier stage 5 did not, or the ref moved past the prune since): then it is built once more, pruned. A pruned
# build carries .tool-pruned.
if [ -f "$app/.tool-ref" ] && [ "$(cat "$app/.tool-ref")" = "$ref" ] &&
  [ -f "$app/packages/mcp-server/dist/standalone.js" ] &&
  { [ -f "$app/.tool-pruned" ] || ! tool_prunable "$app"; }; then
  ok "$ref is already built in $app"
else
  if [ -f "$app/.tool-ref" ] && [ "$(cat "$app/.tool-ref")" = "$ref" ]; then
    warn "$ref is built in $app without dropping the dev packages: building it again, pruned (the old copy stays as app.prev until the next build, so the disk drops only then)"
  fi
  build="$TOOL_DIR/build"
  log="$TOOL_DIR/build.log"
  rm -rf "${build:?}"
  trap 'rm -rf "${build:?}"' EXIT
  git init -q "$build"
  git -C "$build" remote add origin "$repo"
  git -C "$build" fetch -q --depth 1 origin "$ref" || die "cannot fetch $ref from $repo"
  git -C "$build" checkout -q FETCH_HEAD
  commit="$(git -C "$build" rev-parse --short HEAD)"
  ok "fetched $ref ($commit); building, a few minutes"
  # HUSKY=0: no git hooks on a server. Playwright never downloads browsers (Debian's chromium is used).
  if ! (cd "$build" && HUSKY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund &&
    npm run build) >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    die "the build of $ref failed (full log: $log)"
  fi
  for f in packages/mcp-server/dist/standalone.js packages/cogm-dashboard/dist/server.js \
    packages/foundry-module/dist/main.js; do
    [ -f "$build/$f" ] || die "the build of $ref has no $f"
  done
  # The dev packages (compilers, test runners, Storybook, linters) only serve the build: drop them. The Assistant
  # GM driver and stages 11 and 13 load playwright-core from this build, so a ref that still lists it as a dev
  # package (older tags such as v0.21.0) keeps them all.
  size_before="$(du -sm "$build" | cut -f1)"
  if tool_prunable "$build"; then
    if ! (cd "$build" && npm prune --omit=dev --no-audit --no-fund) >>"$log" 2>&1; then
      tail -n 40 "$log" >&2
      die "npm prune of the $ref build failed (full log: $log)"
    fi
    # Scope folders (@storybook, ...) whose last package went are left empty.
    find "$build/node_modules" -maxdepth 1 -type d -name '@*' -empty -delete || warn "could not remove the empty scope folders (harmless)"
    : >"$build/.tool-pruned"
    ok "dev packages removed: $size_before MB -> $(du -sm "$build" | cut -f1) MB"
  else
    warn "$ref lists playwright-core as a dev package (the Assistant GM needs it): dev packages kept ($size_before MB)"
  fi
  (cd "$build" && node -e 'require.resolve("playwright-core")') >/dev/null 2>&1 ||
    die "the build of $ref has no playwright-core: the Assistant GM could not start"
  # Before anything stops: the pruned build must load. A failure leaves the services and the old copy in $app as they are.
  loads_out="$(check_build_loads "$build" 2>&1)" ||
    die "the pruned build of $ref does not load (a runtime package is missing?); nothing was stopped, the services and $app are as they were:
$loads_out"
  ok "the pruned build loads (bridge, dashboard app, shared, Discord recorder)"
  printf '%s\n' "$ref" >"$build/.tool-ref"
  if [ "$STACK" = containers ]; then
    # The images are built from the new tree before anything moves; a failure leaves the containers and $app alone.
    containers_prepare_build "$build" "$ref"
  else
    require_quiet "swapping in the new build (it stops the bridge, dashboard and Assistant GM)"
    if have_systemd; then
      for unit in foundry-ai-tool-gm-browser foundry-ai-tool-dashboard foundry-ai-tool-bridge; do
        systemctl stop "$unit.service" 2>/dev/null || true
      done
    fi
  fi
  # The previous build stays next to it for a quick rollback.
  rm -rf "${app:?}.prev"
  [ -d "$app" ] && mv "$app" "$app.prev"
  mv "$build" "$app" || {
    [ ! -d "$app.prev" ] || mv "$app.prev" "$app"
    die "could not move the new build into $app; the old copy was put back"
  }
  if [ "$STACK" != containers ]; then
    # A stop above that failed silently must still end in a restart onto the new build.
    mark_changed /etc/systemd/system/foundry-ai-tool-bridge.service /etc/systemd/system/foundry-ai-tool-dashboard.service /etc/systemd/system/foundry-ai-tool-gm-browser.service
  fi
  trap - EXIT
  chown -R root:root "$app"
  chmod 755 "$app"
  ok "built $ref ($commit), version $(node -p "require('$app/package.json').version") in $app"
  # Building the running tag again (the prune) is not a new release.
  [ "$prev_ref" = "$ref" ] || built_new=1
fi

say "the Foundry module"
stage="$(mktemp -d)"
trap 'rm -rf "${stage:?}"' EXIT
src="$app/packages/foundry-module"
# The same files as the release zip (.github/workflows/release.yml, "Package the module").
cp "$src/module.json" "$stage/"
cp -r "$src/dist" "$stage/dist"
find "$stage/dist" \( -name '*.map' -o -name '*.d.ts' \) -delete
for d in lang styles templates; do
  [ -d "$src/$d" ] && cp -r "$src/$d" "$stage/$d"
done
if [ -d "$module_dir" ] && diff -rq "$stage" "$module_dir" >/dev/null 2>&1; then
  ok "module unchanged in $module_dir"
else
  rm -rf "${module_dir:?}"
  mkdir -p "$(dirname "$module_dir")"
  cp -a "$stage" "$module_dir"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$module_dir"
  chmod 755 "$module_dir"
  ok "installed the module in $module_dir"
  if [ "$STACK" = containers ]; then
    module_installed=1 # the warning comes after containers_apply, which may recreate Foundry (then it has the module already)
  elif have_systemd && systemctl is-active --quiet foundry.service; then
    warn "Foundry is running: restart it (systemctl restart foundry) when no one plays, so it loads the new module"
  fi
fi
rm -rf "${stage:?}"
trap - EXIT

say "folders"
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA/vault" "$TOOL_DATA/dashboard" \
  "$TOOL_DATA/gm-browser" "$TOOL_DATA/logs"
install -d -m 0755 "$driver_dir"
ok "$TOOL_DATA/{vault,dashboard,gm-browser,logs}"

say "the Assistant GM browser driver"
if [ -f "$driver_src" ]; then
  install -m 0644 "$driver_src" "$driver_dir/assistant-gm.mjs"
  rm -f "$driver_src"
  ok "installed $driver_dir/assistant-gm.mjs"
elif [ -f "$driver_dir/assistant-gm.mjs" ]; then
  ok "driver already installed (no new copy in $driver_src)"
elif [ "$STACK" = containers ]; then
  ok "no driver copy needed: the Assistant GM container has it baked into its image"
else
  die "no driver at $driver_src: scp scripts/pi/remote/assistant-gm.mjs foundry-pi:/root/ first"
fi

# The Pi's name on the tailnet, for the dashboard's DNS rebinding guard.
ts_name=""
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  ts_name="$(tailscale status --json | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).Self?.DNSName||"";process.stdout.write(n.replace(/\.$/,""))})')"
fi

say "services"
if [ "$STACK" = containers ]; then
  ok "the stack runs as containers (project $COMPOSE_LIVE_PROJECT): no unit files, nothing enabled or restarted through systemd"
  containers_apply
  if [ "${module_installed:-0}" = 1 ] && [ "${foundry_recreated:-0}" != 1 ] && [ -n "$(svc_cid foundry)" ]; then
    warn "Foundry is running: restart the container $(svc_cid foundry) when no one plays, so it loads the new module"
  fi
fi
common="User=$FOUNDRY_USER
Group=$FOUNDRY_USER
Environment=HOME=$TOOL_DATA
Environment=NODE_ENV=production
Environment=MCP_CONTROL_HOST=127.0.0.1
Environment=MCP_CONTROL_PORT=31414
Environment=FOUNDRY_AI_DATA_DIR=$TOOL_DATA/vault
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
ReadWritePaths=$TOOL_DATA"

bridge_unit="[Unit]
Description=Foundry AI Tool bridge (the MCP backend; control port 31414 and Foundry link 31415 on loopback)
After=network-online.target foundry.service
Wants=network-online.target

[Service]
$common
Environment=FOUNDRY_LINK_HOST=127.0.0.1
# Log at info into a rotated file that survives restarts (the default, under the private /tmp, is lost at
# every restart). bridge.env can still override both.
Environment=LOG_LEVEL=info
Environment=LOG_FILE_PATH=$TOOL_DATA/logs/mcp-server.log
EnvironmentFile=-$TOOL_ETC/bridge.env
WorkingDirectory=$app
ExecStart=$NODE_DIR/bin/node $app/packages/mcp-server/dist/standalone.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"

dashboard_unit="[Unit]
Description=Foundry AI Tool co-GM dashboard (port 3000 on loopback)
After=foundry-ai-tool-bridge.service
Wants=foundry-ai-tool-bridge.service

[Service]
$common
Environment=PORT=3000
Environment=DASHBOARD_HOST=127.0.0.1
Environment=COGM_STATE_DIR=$TOOL_DATA/dashboard
Environment=DASHBOARD_ALLOWED_HOSTS=$ts_name
EnvironmentFile=-$TOOL_ETC/dashboard.env
# Cloudflare Access settings (Part C): their own file, read after dashboard.env, which stage 7 rewrites whole
EnvironmentFile=-$TOOL_ETC/dashboard-access.env
WorkingDirectory=$app/packages/cogm-dashboard
ExecStart=$NODE_DIR/bin/node $app/packages/cogm-dashboard/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"

browser_unit="[Unit]
Description=Foundry AI Tool Assistant GM (headless Chromium logged into Foundry, holds the bridge link)
After=foundry.service foundry-ai-tool-bridge.service
Wants=foundry-ai-tool-bridge.service

[Service]
$common
Environment=TOOL_APP=$app
Environment=FOUNDRY_URL=http://127.0.0.1:30000
Environment=CHROMIUM=/usr/bin/chromium
Environment=GM_BROWSER_PROFILE=$TOOL_DATA/gm-browser
EnvironmentFile=$TOOL_ETC/assistant-gm.env
# Low priority: the Assistant GM's Chromium must never compete with Foundry's main thread on game night (I-098)
Nice=10
CPUWeight=20
ExecStart=$NODE_DIR/bin/node $driver_dir/assistant-gm.mjs run
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target"

if [ "$STACK" != containers ]; then
  write_file /etc/systemd/system/foundry-ai-tool-bridge.service 0644 "$bridge_unit" || true
  write_file /etc/systemd/system/foundry-ai-tool-dashboard.service 0644 "$dashboard_unit" || true
  write_file /etc/systemd/system/foundry-ai-tool-gm-browser.service 0644 "$browser_unit" || true
  enable_unit foundry-ai-tool-bridge.service "$TOOL_ETC/bridge.env"
  enable_unit foundry-ai-tool-dashboard.service "$TOOL_ETC/dashboard.env" "$TOOL_ETC/dashboard-access.env"
  if [ -f "$TOOL_ETC/assistant-gm.env" ]; then
    enable_unit foundry-ai-tool-gm-browser.service "$TOOL_ETC/assistant-gm.env"
  else
    warn "no $TOOL_ETC/assistant-gm.env yet: the Assistant GM browser starts once it exists (5-check-world.sh writes it for the check world)"
  fi
fi

say "Tailscale serve (tailnet only)"
if [ -n "$ts_name" ]; then
  serve="$(tailscale serve status 2>/dev/null || true)"
  if printf '%s' "$serve" | grep -q ':31414'; then
    ok "control port already shared"
  else
    tailscale serve --bg --tcp 31414 tcp://127.0.0.1:31414 >/dev/null
    ok "control port shared: $ts_name:31414"
  fi
  if printf '%s' "$serve" | grep -q ':3000'; then
    ok "dashboard already shared"
  else
    tailscale serve --bg --http 3000 http://127.0.0.1:3000 >/dev/null
    ok "dashboard shared: http://$ts_name:3000"
  fi
else
  warn "Tailscale is not running here: nothing shared (a test container?)"
fi

warn_dashboard_split || true

if have_systemd; then
  say "checks"
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null http://127.0.0.1:3000/ && break
    sleep 2
  done
  curl -fs -o /dev/null http://127.0.0.1:3000/ && ok "dashboard answers on 127.0.0.1:3000" && dash_ok=1 ||
    warn "dashboard does not answer yet; see: $(if [ "$STACK" = containers ]; then svc_logs_hint dashboard; else echo 'journalctl -u foundry-ai-tool-dashboard -n 50'; fi)"
  ss -ltn | grep -E ':(31414|31415|3000) ' || true
  # Tailscale serve listens on the Pi's tailnet addresses (100.64.0.0/10 and fd7a:115c:a1e0::/48);
  # that is the intended sharing, so only other addresses count as a leak.
  # ss prints the interface scope: 100.x.y.z%tailscale0:PORT and [fd7a:...]%tailscale0:PORT (as control_port_check in lib.sh).
  tailnet='%tailscale[0-9]*:'
  if ss -ltn | grep -E ':(31414|31415|3000) ' | grep -vE '127\.0\.0\.1:|\[::1\]:' |
    grep -vqE "$tailnet"; then
    warn "a tool port listens beyond loopback and the tailnet; check the $(if [ "$STACK" = containers ]; then echo 'containers (docker ps)'; else echo units; fi)"
  else
    ok "tool ports listen on loopback, shared only with the tailnet"
  fi
fi

# A release tag the Pi did not run before was built and the dashboard answers: one English line in
# #changelog (a normal post, rare). Off until the bot env on the Pi has DISCORD_CHANGELOG_CHANNEL_ID; a
# failure is never fatal (announce.mjs prints one warning line). A run that dies before this point posts
# nothing, and the rerun finds the build already there, so it posts nothing either (a courtesy post).
if [ "${built_new:-}" = 1 ] && [ "${dash_ok:-}" = 1 ] && printf '%s' "$ref" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' &&
  [ -f "$app/packages/discord-bot/announce/announce.mjs" ]; then
  timeout 15 "$NODE_DIR/bin/node" "$app/packages/discord-bot/announce/announce.mjs" deploy "$ref" || true
fi

# Stage 33 follows stage 5 (the GM vault's Obsidian plugin must match this build): its read-only CHECK result ends this
# stage as one warning line, so a forgotten stage 33 shows up here. Never fatal; it changes nothing.
stage33="$app/scripts/pi/remote/33-obsidian-plugin.sh"
if [ -f "$stage33" ] && [ -f "$app/scripts/pi/remote/lib.sh" ]; then
  # The output stays in a variable (no fixed /tmp file). "not in step" is the check's own verdict; any other failure (a
  # missing vault or build, a timeout) means the check could not run, which is a different line.
  rc=0
  check33="$(cat "$app/scripts/pi/remote/lib.sh" "$stage33" | CHECK=1 timeout 60 bash -s 2>&1)" || rc=$?
  if [ "$rc" = 0 ]; then
    ok "stage 33 check: the GM vault's Obsidian plugin matches this build"
  elif printf '%s' "$check33" | grep -q 'stage 33 check: not in step'; then
    warn "stage 33 check: the GM vault's Obsidian plugin is not in step with this build: run stage 33 next (snapshot and the user's OK first)"
  else
    warn "stage 33 check could not run (exit $rc), so it is not known whether the plugin matches this build: run stage 33 with CHECK=1 by hand; details: $(printf '%s' "$check33" | tail -n 3 | tr '\n' ' ')"
  fi
fi

say "stage 5 done: run 5-check-world.sh for the throwaway check world, or set up the Assistant GM in the real world"
