#!/usr/bin/env bash
# Stage 8: the recorder bot on the Pi (D-068). It records the Discord voice channel one track per
# speaker into /var/lib/foundry-ai-tool/recordings; this PC copies finished sessions over Tailscale
# for transcription (tools/session-notes/pull.ps1) and deletes them on the Pi a week later.
# The bot comes from the tool build stage 5 made ($TOOL_DIR/app, the same TOOL_REF), so the bot and
# the bridge always share a version: after a new stage 5 build, run this stage again.
# Claude runs:  cat scripts/pi/remote/lib.sh scripts/pi/remote/8-recorder.sh | ssh foundry-pi 'bash -s'
# The token: the user runs scripts/pi/set-discord-token.ps1 on the PC (it asks for the token without
# showing it and writes it into /etc/foundry-ai-tool/discord-bot.env); Claude never types or prints it.
# Until the env file has a token, this stage installs everything but leaves the service stopped.

require_root
require_arm64
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
app="$TOOL_DIR/app"
src="$app/packages/discord-bot"
[ -f "$src/dist/cli.js" ] || die "the tool build has no recorder bot ($src/dist/cli.js): run stage 5 first"
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
export PATH="$NODE_DIR/bin:$PATH"

bot_dir="$TOOL_DIR/discord-bot"
rec_dir="$TOOL_DATA/recordings"
env_file="$TOOL_ETC/discord-bot.env"
unit=foundry-ai-tool-discord-bot.service
ref="$(cat "$app/.tool-ref" 2>/dev/null || echo unknown)"

say "the bot from the $ref build"
if [ -f "$bot_dir/.tool-ref" ] && [ "$(cat "$bot_dir/.tool-ref")" = "$ref" ] &&
  [ -f "$bot_dir/dist/cli.js" ] && [ -d "$bot_dir/node_modules" ]; then
  ok "$ref already installed in $bot_dir"
else
  new="$bot_dir.new"
  log="$TOOL_DIR/discord-bot-install.log"
  rm -rf "${new:?}"
  trap 'rm -rf "${new:?}"' EXIT
  mkdir -p "$new"
  cp -r "$src/dist" "$new/dist"
  find "$new/dist" \( -name '*.map' -o -name '*.d.ts' \) -delete
  # Pin each dependency to the exact version the stage 5 build installed and tested, so a plain
  # `npm install` here cannot pull a newer discord.js than the bridge build was checked with.
  node -e '
    const fs = require("fs"), path = require("path");
    const [src, app, out] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
    const find = (dep) => {
      for (const dir of [src, app]) {
        const f = path.join(dir, "node_modules", dep, "package.json");
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")).version;
      }
      throw new Error("not installed in the build: " + dep);
    };
    const deps = {};
    for (const dep of Object.keys(pkg.dependencies || {})) deps[dep] = find(dep);
    const outPkg = { name: pkg.name, version: pkg.version, private: true, type: pkg.type,
      main: pkg.main, engines: pkg.engines, dependencies: deps };
    fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(outPkg, null, 2) + "\n");
    console.log("    pinned: " + Object.entries(deps).map(([d, v]) => d + "@" + v).join(" "));
  ' "$src" "$app" "$new"
  # No build tools needed: the only native part (@snazzah/davey) ships a linux-arm64-gnu binary.
  if ! (cd "$new" && npm install --omit=dev --no-audit --no-fund --no-package-lock) >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    die "npm install for the bot failed (full log: $log)"
  fi
  printf '%s\n' "$ref" >"$new/.tool-ref"
  was_active=0
  if have_systemd && systemctl is-active --quiet "$unit"; then
    was_active=1
    # SIGINT (the unit's KillSignal) ends a running recording cleanly and converts it.
    say "stopping the running bot for the update (a recording in progress is closed and converted)"
    systemctl stop "$unit"
  fi
  # The previous version stays next to it for a quick rollback.
  rm -rf "${bot_dir:?}.prev"
  [ -d "$bot_dir" ] && mv "$bot_dir" "$bot_dir.prev"
  mv "$new" "$bot_dir"
  trap - EXIT
  chown -R root:root "$bot_dir"
  chmod 755 "$bot_dir"
  ok "installed the bot $(node -p "require('$bot_dir/package.json').version") ($ref) in $bot_dir"
  if [ "$was_active" = 1 ]; then ok "the service starts again below"; fi
fi
# A smoke test that needs no token: the bot's code and its native part load on this board.
(cd "$bot_dir" && node -e 'import("@snazzah/davey").then(() => import("discord.js")).then(() => console.log("    ok: discord.js and @snazzah/davey load"))') ||
  die "the bot's modules do not load on this board; see $TOOL_DIR/discord-bot-install.log"

say "the recordings folder"
# 2770: the foundry group may write, and new sessions inherit the group, so the PC's pull can mark
# and delete sessions also when its SSH user is a group member rather than root.
install -d -m 2770 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$rec_dir"
ok "$rec_dir (foundry:foundry, 2770)"

say "the settings file"
mkdir -p "$TOOL_ETC"
if [ -f "$env_file" ]; then
  ok "$env_file already there (kept as it is)"
else
  install -m 0640 -o root -g "$FOUNDRY_USER" "$src/deploy/discord-bot.env.example" "$env_file"
  ok "wrote $env_file from the example (no token yet)"
fi
chown "root:$FOUNDRY_USER" "$env_file"
chmod 0640 "$env_file"
# Read whether a token is set without printing it.
has_token=0
if grep -Eq '^DISCORD_TOKEN=[^[:space:]]+' "$env_file"; then has_token=1; fi
if grep -Eq "^FVTT_SESSIONS_DIR=$rec_dir\$" "$env_file"; then
  ok "recordings go to $rec_dir"
else
  warn "FVTT_SESSIONS_DIR in $env_file is not $rec_dir: the PC's pull looks in $rec_dir"
fi

say "the service"
# The unit file from the same build (packages/discord-bot/deploy), so it matches the bot's paths.
unit_changed=0
if write_file "/etc/systemd/system/$unit" 0644 "$(cat "$src/deploy/$unit")"; then unit_changed=1; fi
if ! have_systemd; then
  warn "no systemd here (a test container?): $unit written, not started"
elif [ "$has_token" = 0 ]; then
  systemctl daemon-reload
  systemctl disable "$unit" >/dev/null 2>&1 || true
  warn "no token in $env_file yet: the service stays off. Run scripts/pi/set-discord-token.ps1 on the PC; it starts the bot."
elif [ "$unit_changed" = 1 ] || ! systemctl is-active --quiet "$unit"; then
  enable_unit "$unit"
else
  systemctl enable "$unit" >/dev/null 2>&1
  ok "$unit already running"
fi
if have_systemd && systemctl is-active --quiet "$unit"; then
  # Only the bot's own login line; never the whole journal (a library could print the token).
  for _ in $(seq 1 20); do
    journalctl -u "$unit" --since "-2 min" --no-pager -o cat 2>/dev/null | grep -q 'Logged in as' && break
    sleep 1
  done
  if journalctl -u "$unit" --since "-2 min" --no-pager -o cat 2>/dev/null | grep -q 'Logged in as'; then
    ok "the bot logged in to Discord"
  else
    warn "the bot runs but has not logged in yet; check: journalctl -u $unit -n 20"
  fi
fi

say "stage 8 done: bot $ref in $bot_dir, recordings in $rec_dir, token $([ "$has_token" = 1 ] && echo set || echo 'not set yet')"
