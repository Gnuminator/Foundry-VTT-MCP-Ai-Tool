#!/usr/bin/env bash
# Stage 5 check: a throwaway world "pi-check" (dnd5e) that proves the whole chain on the Pi
# (Foundry, the module, the Assistant GM browser, the bridge, the dashboard). Never the campaign
# world. Run after 5-tool.sh:  cat scripts/pi/remote/lib.sh scripts/pi/remote/5-check-world.sh | ssh foundry-pi 'bash -s'
# Foundry launches the world by itself (options.json "world"), so no admin password is needed.
# Passwords are generated here and kept only in root-only files under /etc/foundry-ai-tool:
#   assistant-gm.env  the Assistant GM user (read by the foundry-ai-tool-gm-browser service)
#   check-world.env   the world's Gamemaster user (to join the check world by hand:
#                     ssh foundry-pi cat /etc/foundry-ai-tool/check-world.env)
# Nothing is printed. CHECK_WORLD overrides the world below. dnd5e is installed only when none is: every world on
# the Pi shares that one folder and migrates to its version, so an installed dnd5e is never replaced here (stage 14
# changes the version). DND5E_VERSION (default 6.0.5) is the version a first install takes; given while another
# version is installed, the stage refuses.

require_root
require_arm64
[ -f "$TOOL_DIR/gm-browser/assistant-gm.mjs" ] || die "run 5-tool.sh first"

world="${CHECK_WORLD:-pi-check}"
data="$FOUNDRY_DATA/Data"
options="$FOUNDRY_DATA/Config/options.json"
export PATH="$NODE_DIR/bin:$PATH"

json_get() { node -e 'const o=require(process.argv[1]);process.stdout.write(String(o[process.argv[2]]??""))' "$1" "$2"; }
new_password() { head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }

# It launches the check world, which would migrate to a dnd5e version on trial.
refuse_during_system_trial "stage 5's check world"

say "the dnd5e system"
sys="$data/systems/dnd5e"
installed=""
[ ! -f "$sys/system.json" ] || installed="$(json_get "$sys/system.json" version)"
if [ -n "$installed" ]; then
  [ -z "${DND5E_VERSION:-}" ] || [ "$DND5E_VERSION" = "$installed" ] ||
    die "dnd5e $installed is installed, not DND5E_VERSION=$DND5E_VERSION: this stage never replaces it (every world runs on it; stage 14 changes the version). Nothing was changed"
  dnd5e_version="$installed"
  ok "dnd5e $installed installed (kept; stage 14 changes the version)"
else
  dnd5e_version="${DND5E_VERSION:-6.0.5}"
  url="https://github.com/foundryvtt/dnd5e/releases/download/release-$dnd5e_version/dnd5e-release-$dnd5e_version.zip"
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' EXIT
  curl -fsSL -o "$tmp/dnd5e.zip" "$url" || die "cannot download $url"
  unzip -q "$tmp/dnd5e.zip" -d "$tmp/dnd5e"
  [ "$(json_get "$tmp/dnd5e/system.json" id)" = "dnd5e" ] || die "the download is not the dnd5e system"
  [ "$(json_get "$tmp/dnd5e/system.json" version)" = "$dnd5e_version" ] || die "the download is not dnd5e $dnd5e_version"
  rm -rf "${sys:?}"
  mkdir -p "$data/systems"
  cp -a "$tmp/dnd5e" "$sys"
  chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$sys"
  chmod 755 "$sys"
  rm -rf "${tmp:?}"
  trap - EXIT
  ok "installed dnd5e $dnd5e_version"
fi

say "the world $world"
wdir="$data/worlds/$world"
core="$(json_get "$FOUNDRY_APP/package.json" version)"
if [ -f "$wdir/world.json" ]; then
  ok "$world exists"
else
  install -d -m 0755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$wdir"
  printf '%s\n' "{
  \"id\": \"$world\",
  \"title\": \"Pi check (throwaway, never the campaign)\",
  \"system\": \"dnd5e\",
  \"coreVersion\": \"$core\",
  \"systemVersion\": \"$dnd5e_version\",
  \"compatibility\": { \"minimum\": \"14\", \"verified\": \"14\" },
  \"description\": \"Stage 5 check world for the Foundry AI Tool on the Pi. Safe to delete.\"
}" >"$wdir/world.json"
  chown "$FOUNDRY_USER:$FOUNDRY_USER" "$wdir/world.json"
  ok "created $wdir"
fi

say "passwords (generated, never shown)"
assistant_env="$TOOL_ETC/assistant-gm.env"
world_env="$TOOL_ETC/check-world.env"
umask 077
if [ -f "$assistant_env" ]; then
  ok "$assistant_env exists"
else
  printf 'ASSISTANT_GM_USER="Assistant GM"\nASSISTANT_GM_PASSWORD="%s"\n' "$(new_password)" >"$assistant_env"
  ok "wrote $assistant_env"
fi
if [ -f "$world_env" ]; then
  ok "$world_env exists"
else
  printf 'CHECK_WORLD=%s\nPROVISION_GM_USER=Gamemaster\nPROVISION_GM_NEW_PASSWORD="%s"\n' "$world" "$(new_password)" >"$world_env"
  ok "wrote $world_env"
fi
umask 022
chown root:root "$assistant_env" "$world_env"
chmod 600 "$assistant_env" "$world_env"

say "Foundry launches $world by itself"
[ -f "$options" ] || die "no $options: has Foundry started once (stage 3)?"
current="$(json_get "$options" world)"
if [ "$current" = "$world" ]; then
  ok "options.json already launches $world"
else
  [ -z "$current" ] || [ "${FORCE_WORLD:-}" = 1 ] ||
    die "options.json launches '$current'; this script never replaces another world (FORCE_WORLD=1 to override)"
  if have_systemd; then systemctl stop foundry.service; fi
  node -e 'const fs=require("fs");const p=process.argv[1];const o=JSON.parse(fs.readFileSync(p,"utf8"));o.world=process.argv[2];fs.writeFileSync(p,JSON.stringify(o,null,2)+"\n")' "$options" "$world"
  ok "options.json launches $world"
  if have_systemd; then systemctl start foundry.service; fi
fi
if have_systemd; then
  systemctl is-active --quiet foundry.service || systemctl start foundry.service
fi
# /join answers 200 even when no world runs (an error page), so look for the join form's template.
world_up() { curl -fs http://127.0.0.1:30000/join 2>/dev/null | grep -q 'id="join-game"'; }
for _ in $(seq 1 60); do
  world_up && break
  sleep 2
done
# Without systemd (a test container) Foundry is started by hand; run this script again then.
world_up || die "$world is not running on port 30000: Foundry shows no active game session (is the licence signed? see: journalctl -u foundry -n 50)"
ok "$world is running"

say "provision: the module, the Assistant GM user, the bridge user"
if have_systemd; then systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true; fi
(
  set -a
  # shellcheck disable=SC1090
  . "$assistant_env"
  # shellcheck disable=SC1090
  . "$world_env"
  set +a
  runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" TOOL_APP="$TOOL_DIR/app" \
    FOUNDRY_URL=http://127.0.0.1:30000 CHROMIUM=/usr/bin/chromium \
    ASSISTANT_GM_USER="$ASSISTANT_GM_USER" ASSISTANT_GM_PASSWORD="$ASSISTANT_GM_PASSWORD" \
    PROVISION_GM_USER="$PROVISION_GM_USER" PROVISION_GM_PASSWORD="" \
    PROVISION_GM_NEW_PASSWORD="$PROVISION_GM_NEW_PASSWORD" \
    node "$TOOL_DIR/gm-browser/assistant-gm.mjs" provision
) || die "provisioning failed (see the lines above)"

if have_systemd; then
  enable_unit foundry-ai-tool-gm-browser.service
  for _ in $(seq 1 45); do
    journalctl -u foundry-ai-tool-gm-browser --since '-3 min' | grep -q 'joined world' && break
    sleep 2
  done
  journalctl -u foundry-ai-tool-gm-browser -n 5 --no-pager | grep 'assistant-gm' || true
  if journalctl -u foundry-ai-tool-bridge --since '-3 min' --no-pager | grep -qi 'foundry.*connect'; then
    ok "the bridge reports a Foundry connection"
  else
    warn "no Foundry connection in the bridge log yet; see: journalctl -u foundry-ai-tool-bridge -n 50"
  fi
fi

say "check world ready: Claude runs the end-to-end check from the PC over Tailscale"
