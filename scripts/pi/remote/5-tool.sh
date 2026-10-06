#!/usr/bin/env bash
# Stage 5: the Foundry AI Tool on the Pi. The bridge and the co-GM dashboard run as services, the
# Foundry module goes into Foundry's data folder, and a headless Chromium stays logged into
# Foundry as the "Assistant GM" user, so the module's link to the bridge runs with no human GM
# online (the module's "bridge user" setting names that user).
# Claude copies the browser driver first:  scp scripts/pi/remote/assistant-gm.mjs foundry-pi:/root/
# then runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/5-tool.sh | ssh foundry-pi 'bash -s'
# TOOL_REF picks the git tag, branch or commit to build (default below). Everything listens on
# loopback only; Tailscale serve shares the control port (31414) and the dashboard (3000) with the
# tailnet, never with the home network or the internet. The bridge's control port has no login of
# its own (vault idea I-023).

require_root
require_arm64
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
[ -f "$FOUNDRY_APP/main.js" ] || die "Foundry is missing: run stage 3 first"

ref="${TOOL_REF:-v0.21.0}"
repo="${TOOL_REPO:-https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git}"
app="$TOOL_DIR/app"
driver_src="${ASSISTANT_GM_DRIVER:-/root/assistant-gm.mjs}"
driver_dir="$TOOL_DIR/gm-browser"
module_dir="$FOUNDRY_DATA/Data/modules/foundry-mcp-bridge"
export PATH="$NODE_DIR/bin:$PATH"

say "packages"
apt_install git ca-certificates chromium fonts-liberation
ok "$(chromium --version 2>/dev/null || echo 'chromium installed')"

say "the tool at $ref"
if [ -f "$app/.tool-ref" ] && [ "$(cat "$app/.tool-ref")" = "$ref" ] &&
  [ -f "$app/packages/mcp-server/dist/standalone.js" ]; then
  ok "$ref is already built in $app"
else
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
  printf '%s\n' "$ref" >"$build/.tool-ref"
  if have_systemd; then
    for unit in foundry-ai-tool-gm-browser foundry-ai-tool-dashboard foundry-ai-tool-bridge; do
      systemctl stop "$unit.service" 2>/dev/null || true
    done
  fi
  # The previous build stays next to it for a quick rollback.
  rm -rf "${app:?}.prev"
  [ -d "$app" ] && mv "$app" "$app.prev"
  mv "$build" "$app"
  trap - EXIT
  chown -R root:root "$app"
  chmod 755 "$app"
  ok "built $ref ($commit), version $(node -p "require('$app/package.json').version") in $app"
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
  if have_systemd && systemctl is-active --quiet foundry.service; then
    warn "Foundry is running: restart it (systemctl restart foundry) when no one plays, so it loads the new module"
  fi
fi
rm -rf "${stage:?}"
trap - EXIT

say "folders"
install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$TOOL_DATA/vault" "$TOOL_DATA/dashboard" \
  "$TOOL_DATA/gm-browser"
install -d -m 0755 "$driver_dir"
ok "$TOOL_DATA/{vault,dashboard,gm-browser}"

say "the Assistant GM browser driver"
if [ -f "$driver_src" ]; then
  install -m 0644 "$driver_src" "$driver_dir/assistant-gm.mjs"
  rm -f "$driver_src"
  ok "installed $driver_dir/assistant-gm.mjs"
elif [ -f "$driver_dir/assistant-gm.mjs" ]; then
  ok "driver already installed (no new copy in $driver_src)"
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
ExecStart=$NODE_DIR/bin/node $driver_dir/assistant-gm.mjs run
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target"

write_file /etc/systemd/system/foundry-ai-tool-bridge.service 0644 "$bridge_unit" || true
write_file /etc/systemd/system/foundry-ai-tool-dashboard.service 0644 "$dashboard_unit" || true
write_file /etc/systemd/system/foundry-ai-tool-gm-browser.service 0644 "$browser_unit" || true
enable_unit foundry-ai-tool-bridge.service
enable_unit foundry-ai-tool-dashboard.service
if [ -f "$TOOL_ETC/assistant-gm.env" ]; then
  enable_unit foundry-ai-tool-gm-browser.service
else
  warn "no $TOOL_ETC/assistant-gm.env yet: the Assistant GM browser starts once it exists (5-check-world.sh writes it for the check world)"
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

if have_systemd; then
  say "checks"
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null http://127.0.0.1:3000/ && break
    sleep 2
  done
  curl -fs -o /dev/null http://127.0.0.1:3000/ && ok "dashboard answers on 127.0.0.1:3000" ||
    warn "dashboard does not answer yet; see: journalctl -u foundry-ai-tool-dashboard -n 50"
  ss -ltn | grep -E ':(31414|31415|3000) ' || true
  # Tailscale serve listens on the Pi's tailnet addresses (100.64.0.0/10 and fd7a:115c:a1e0::/48);
  # that is the intended sharing, so only other addresses count as a leak.
  tailnet='100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+:|\[fd7a:115c:a1e0:'
  if ss -ltn | grep -E ':(31414|31415|3000) ' | grep -vE '127\.0\.0\.1:|\[::1\]:' |
    grep -vqE "$tailnet"; then
    warn "a tool port listens beyond loopback and the tailnet; check the units"
  else
    ok "tool ports listen on loopback, shared only with the tailnet"
  fi
fi

say "stage 5 done: run 5-check-world.sh for the throwaway check world, or set up the Assistant GM in the real world"
