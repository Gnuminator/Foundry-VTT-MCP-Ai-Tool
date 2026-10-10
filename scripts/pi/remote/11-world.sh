#!/usr/bin/env bash
# Stage 11: install a world bundle that scripts/pi/push-world.ps1 uploaded (docs/dev/PI-SETUP.md, "Licensed
# content"). The bundle holds the campaign world, its private modules and the image folders it uses.
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/11-world.sh | ssh foundry-pi 'BUNDLE=/var/lib/foundry-import/curse-of-strahd-<stamp>.tar bash -s'
# Take a snapshot first (dietpi-backup 1) and get the user's OK: this stops Foundry for a few minutes.
# Env: BUNDLE (required, a .tar under /var/lib/foundry-import/), WORLD (curse-of-strahd), KIT_WORLD (strahd-kit; empty
#   skips it), KIT_TITLE, LAUNCH (the world Foundry starts with; WORLD or KIT_WORLD, default WORLD),
#   REPLACE_WORLD (1 replaces an existing WORLD; default 0 keeps it), GM_USER (the world's GM, default Gamemaster),
#   REPLACE_NEWER (push-back only: 1 replaces the Pi's world even when it changed after the Plan B snapshot),
#   EXTRA_GM_USER (a second GM user, for example Claude, with its own generated password; default none).
# LAUNCH may also name a world that is already installed (another campaign), so a second world, for example the
# Frostmaiden training world (D-118: WORLD=frostmaiden-training KIT_WORLD= LAUNCH=curse-of-strahd
# EXTRA_GM_USER=Claude), goes in next to it while Foundry keeps launching that world.
# A Plan B push-back (docs/dev/PLAN-B.md, "After the night"; built by scripts/plan-b/push-back.ps1) brings the
# world back from the PC with the Pi's own GM password: its MANIFEST.txt says "gm-password: kept (push-back)" and
# "based-on-snapshot: <the Pi backup Plan B restored>". Such a bundle needs REPLACE_WORLD=1, KIT_WORLD= (empty)
# and the Pi's $TOOL_ETC/world-<WORLD>.env, else nothing changes. After Foundry stops, a change check scans a copy
# of the Pi's world: a document created or changed after the snapshot time stops the run (Foundry starts again
# on the old world) unless REPLACE_NEWER=1. A document that is the same in the bundle (same key and times, so
# an earlier run of this push-back installed it) does not count. A module the Pi updated after the snapshot
# (its module.json version is newer than the bundle's) is kept, not downgraded. A plain bundle runs as before.
# What it does: checks the tar before it extracts (no links or devices, no paths outside Data/, no env or cookie
# files, no ddb-importer or bridge module), checks every checksum, moves the old copies to
# /var/lib/foundry-import/prev-<stamp> (never deleted), installs, gives the worlds a generated GM password in a
# root-only file (/etc/foundry-ai-tool/world-<id>.env, never printed), provisions the Assistant GM and the bridge,
# and starts Foundry on LAUNCH. The real world is never replaced unless REPLACE_WORLD=1; the kit world is always
# reset to the bundle's copy. Modules are always replaced (old ones go to prev); an image with the same name
# and other content is copied to prev first. Space is checked first (20% free warns, under 5% stops). If the run
# fails after Foundry was stopped, options.json is put back and Foundry starts again: on the old world if the
# run failed before the world swap, on the bundle's world if it failed after it (the message says which; the
# old world is in prev either way). Safe to run again with the same bundle.

require_root
require_arm64
BUNDLE="${BUNDLE:-}"
WORLD="${WORLD:-curse-of-strahd}"
KIT_WORLD="${KIT_WORLD-strahd-kit}"
KIT_TITLE="${KIT_TITLE:-Curse of Strahd (test copy for kit runs)}"
LAUNCH="${LAUNCH:-$WORLD}"
REPLACE_WORLD="${REPLACE_WORLD:-0}"
GM_USER="${GM_USER:-Gamemaster}"
EXTRA_GM_USER="${EXTRA_GM_USER:-}"
REPLACE_NEWER="${REPLACE_NEWER:-0}"
IMPORT=/var/lib/foundry-import
data="$FOUNDRY_DATA/Data"
options="$FOUNDRY_DATA/Config/options.json"
assistant_env="$TOOL_ETC/assistant-gm.env"
stamp="$(date +%Y%m%d-%H%M%S)"
export PATH="$NODE_DIR/bin:$PATH"

say "checking the request"
[ -n "$BUNDLE" ] || die "BUNDLE is required, for example BUNDLE=$IMPORT/curse-of-strahd-<stamp>.tar"
real="$(realpath -e -- "$BUNDLE" 2>/dev/null)" || die "no such bundle: $BUNDLE"
case "$real" in "$IMPORT"/*.tar) ;; *) die "the bundle must be a .tar under $IMPORT/ (got $real)" ;; esac
[ -f "$real" ] || die "$real is not a regular file"
BUNDLE="$real"
for id in "$WORLD" "$LAUNCH"; do
  [[ "$id" =~ ^[a-z0-9-]+$ ]] || die "'$id' is not a valid world id (lowercase letters, digits, dashes)"
done
if [ -n "$KIT_WORLD" ]; then
  [[ "$KIT_WORLD" =~ ^[a-z0-9-]+$ ]] || die "'$KIT_WORLD' is not a valid world id"
  [ "$KIT_WORLD" != "$WORLD" ] || die "KIT_WORLD must differ from WORLD"
fi
[ "$LAUNCH" = "$WORLD" ] || { [ -n "$KIT_WORLD" ] && [ "$LAUNCH" = "$KIT_WORLD" ]; } ||
  [ -f "$data/worlds/$LAUNCH/world.json" ] || die "LAUNCH must be $WORLD, the kit world or a world that is already installed"
[[ "$GM_USER" =~ ^[A-Za-z0-9._\ -]+$ ]] || die "GM_USER has odd characters"
if [ -n "$EXTRA_GM_USER" ]; then
  [[ "$EXTRA_GM_USER" =~ ^[A-Za-z0-9._\ -]+$ ]] || die "EXTRA_GM_USER has odd characters"
  [ "$EXTRA_GM_USER" != "$GM_USER" ] || die "EXTRA_GM_USER must differ from GM_USER"
fi
# The extra GM a world's login file already names (stage 11 appends EXTRA_GM_USER and EXTRA_GM_PASSWORD).
env_extra_gm() { sed -n 's/^EXTRA_GM_USER="\(.*\)"$/\1/p' "$1" 2>/dev/null; }
[ -f "$assistant_env" ] && [ -f "$TOOL_DIR/gm-browser/assistant-gm.mjs" ] || die "run stage 5 and 5-check-world first (no Assistant GM yet)"
[ -d "$data/modules/foundry-mcp-bridge" ] || die "the bridge module is not installed: run stage 5 first"
if [ -n "$EXTRA_GM_USER" ]; then
  [ "$EXTRA_GM_USER" != "$(
    # shellcheck disable=SC1090
    . "$assistant_env"
    printf '%s' "${ASSISTANT_GM_USER:-Assistant GM}"
  )" ] || die "EXTRA_GM_USER must differ from the Assistant GM"
  for id in "$WORLD" ${KIT_WORLD:+"$KIT_WORLD"}; do
    had="$(env_extra_gm "$TOOL_ETC/world-$id.env")"
    [ -z "$had" ] || [ "$had" = "$EXTRA_GM_USER" ] || die "$TOOL_ETC/world-$id.env already names the extra GM '$had', not '$EXTRA_GM_USER'. Nothing was changed"
  done
fi
[ -f "$options" ] || die "no $options: has Foundry started once (stage 3)?"
bundle_size="$(stat -c %s "$BUNDLE")"

# options.json "world" is what Foundry launches. It is changed while worlds are provisioned, so the first
# value is saved here and put back if the run fails (see on_exit).
set_world() {
  node -e 'const fs=require("fs");const p=process.argv[1];const o=JSON.parse(fs.readFileSync(p,"utf8"));o.world=process.argv[2]||null;fs.writeFileSync(p,JSON.stringify(o,null,2)+"\n")' "$options" "$1"
  world_changed=1
}
orig_world="$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.world||"")' "$options")"
world_changed=0

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

say "inspecting $BUNDLE before extracting"
install -d -m 700 "$IMPORT"
work="$IMPORT/work-$stamp"
prev="$IMPORT/prev-$stamp"
install -d -m 700 "$work" "$work/extract"
# The work folder only holds a copy of the bundle: remove it on any exit (the bundle stays until success).
# A run that stopped Foundry and then failed puts back what ran before (the world in options.json,
# Foundry and the Assistant GM browser), so the Pi is never left in a half state.
stopped=0
was_foundry=0
was_gm_browser=0
world_swapped=0
on_exit() {
  rm -rf "${work:?}"
  # After the swap (line "world $WORLD installed") the Pi's world folder is the bundle's: Foundry starts on it.
  if [ "$world_swapped" = 1 ]; then
    local old="the Pi had no $WORLD before"
    [ ! -d "$prev/worlds/$WORLD" ] || old="the Pi's old one is in $prev/worlds/$WORLD"
    warn "the run failed after $WORLD was replaced: the bundle's $WORLD is installed, $old. Fix the cause above and run again with the same bundle (still in $IMPORT)"
  fi
  if [ "$stopped" = 1 ] && have_systemd; then
    # A failure after set_world can leave Foundry running another world (the kit copy): put the original
    # world back and restart, so the Pi runs what it ran before.
    if [ "$world_changed" = 1 ]; then
      set_world "$orig_world" || true
      warn "options.json restored to launch '${orig_world:-no world}'"
    fi
    # Back to what ran before the run: stop what provisioning started, start what was running.
    if [ "$was_foundry" = 1 ]; then
      systemctl restart foundry.service || true
    else
      systemctl stop foundry.service 2>/dev/null || true
    fi
    if [ "$was_gm_browser" = 1 ]; then
      systemctl is-active --quiet foundry-ai-tool-gm-browser.service || systemctl start foundry-ai-tool-gm-browser.service || true
    fi
    if [ "$world_swapped" = 1 ]; then
      warn "the run did not finish: Foundry and the Assistant GM browser run as before it, but on the bundle's $WORLD (see above); old copies are in $prev"
    else
      warn "the run did not finish: Foundry and the Assistant GM browser are back as they were before it; old copies are in $prev"
    fi
  fi
}
trap on_exit EXIT
tar --quoting-style=literal -tf "$BUNDLE" >"$work/names" || die "cannot read the tar"
tar --quoting-style=literal -tvf "$BUNDLE" | cut -c1 >"$work/types"
[ "$(wc -l <"$work/names")" = "$(wc -l <"$work/types")" ] || die "the tar listing is inconsistent (odd file names)"
bad=0
while IFS= read -r t; do
  case "$t" in - | d) ;; *)
    bad=1
    break
    ;;
  esac
done <"$work/types"
[ "$bad" = 0 ] || die "the tar holds links, devices or other special entries; only files and folders are accepted"
nfiles=0
while IFS= read -r name; do
  n="${name#./}"
  n="${n%/}"
  [ -n "$n" ] && [ "$n" != "." ] || continue
  case "$n" in /*) die "refusing an absolute path: $name" ;; esac
  case "/$n/" in /../* | */../* | */./*) die "refusing a path with .. or . parts: $name" ;; esac
  lower="${n,,}"
  case "$lower" in *.env | *dbb.env* | *cookie* | *ddb-proxy* | *adventure-muncher*) die "refusing a file that must not travel: $name" ;; esac
  case "$n" in
    MANIFEST.txt | SHA256SUMS | Data | Data/worlds | Data/modules | Data/ddb-images | Data/tokenizer) ;;
    Data/worlds/"$WORLD" | Data/worlds/"$WORLD"/*) ;;
    Data/modules/ddb-importer | Data/modules/ddb-importer/* | Data/modules/foundry-mcp-bridge | Data/modules/foundry-mcp-bridge/*)
      die "refusing $name (ddb-importer stays on the PC, the bridge module comes from stage 5)"
      ;;
    Data/modules/*) [[ "${n#Data/modules/}" =~ ^[A-Za-z0-9._-]+(/.*)?$ ]] || die "odd module folder name: $name" ;;
    Data/ddb-images/* | Data/tokenizer/*) ;;
    *) die "refusing $name: not under Data/worlds/$WORLD, Data/modules, Data/ddb-images or Data/tokenizer" ;;
  esac
  nfiles=$((nfiles + 1))
done <"$work/names"
ok "$nfiles entries, all files and folders, all in the allowed places"

say "extracting and checking every checksum"
check_space "$IMPORT" "$IMPORT"
check_space "$FOUNDRY_DATA" "$FOUNDRY_DATA"
free_import="$(df --output=avail -B1 "$IMPORT" | tail -n1 | tr -d ' ')"
[ "$free_import" -gt "$bundle_size" ] || die "not enough space in $IMPORT to extract ($bundle_size bytes needed)"
tar -xf "$BUNDLE" -C "$work/extract" --no-same-owner --no-same-permissions
cd "$work/extract" || die "cannot enter the work folder"
[ -f SHA256SUMS ] && [ -d Data ] || die "the bundle has no SHA256SUMS or no Data folder"
if grep -qvE '^[0-9a-f]{64}  Data/' SHA256SUMS; then die "SHA256SUMS has lines that are not for files under Data/"; fi
sha256sum -c --quiet SHA256SUMS || die "a checksum does not match: the upload is damaged, nothing was installed"
find Data -type f | LC_ALL=C sort >"$work/found"
sed 's/^[0-9a-f]*  //' SHA256SUMS | LC_ALL=C sort >"$work/listed"
extras="$(LC_ALL=C comm -23 "$work/found" "$work/listed" | head -n 3)"
[ -z "$extras" ] || die "files in the bundle that SHA256SUMS does not list, for example: $extras"
[ -f "Data/worlds/$WORLD/world.json" ] || die "the bundle has no Data/worlds/$WORLD/world.json"
ok "all $(wc -l <"$work/listed") files match"

# A Plan B push-back: the world keeps the Pi's own GM password, so only the Pi's world (whose env file holds
# that password) can take it, and the kit world is skipped (its env file holds another password, so its
# provisioning would fail halfway through the run). Checked here, before Foundry stops.
pushback=0
based_on=""
if [ -f MANIFEST.txt ] && grep -q '^gm-password:' MANIFEST.txt; then
  grep -qx 'gm-password: kept (push-back)' MANIFEST.txt || die "MANIFEST.txt has a gm-password: line this stage does not know"
  pushback=1
  based_on="$(sed -n 's/^based-on-snapshot: //p' MANIFEST.txt | head -n1)"
  [[ "$based_on" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] ||
    die "a push-back bundle needs a based-on-snapshot: line in MANIFEST.txt (ISO time in UTC); build it with scripts/plan-b/push-back.ps1. Nothing was changed"
  [ "$REPLACE_WORLD" = 1 ] || die "this is a Plan B push-back (its Gamemaster keeps the Pi's password): run it with REPLACE_WORLD=1 KIT_WORLD= . Nothing was changed"
  [ -z "$KIT_WORLD" ] || die "a push-back skips the kit world (its GM password file holds another password): add KIT_WORLD= . Nothing was changed"
  [ -f "$TOOL_ETC/world-$WORLD.env" ] || die "a push-back needs $TOOL_ETC/world-$WORLD.env (the Pi's GM password, which the pushed world keeps): it is missing. Nothing was changed"
  case "$REPLACE_NEWER" in 0 | 1) ;; *) die "REPLACE_NEWER must be 0 or 1" ;; esac
  ok "a Plan B push-back of $WORLD, based on the Pi backup of $based_on (REPLACE_WORLD=1, no kit world, $TOOL_ETC/world-$WORLD.env present)"
elif [ "$REPLACE_NEWER" != 0 ]; then
  warn "REPLACE_NEWER is for a Plan B push-back only; this bundle is not one, so it is ignored"
fi
modules=()
for d in Data/modules/*/; do [ -d "$d" ] && modules+=("$(basename "$d")"); done
# A push-back ships the modules Plan B restored from the Pi backup. One the Pi updated after that backup (its
# module.json version is higher) is kept: a push-back never downgrades a module. Prints "<pi> <bundle>" then.
module_newer() { # $1 the Pi's module.json, $2 the bundle's
  node -e 'const fs=require("fs");const v=p=>{try{return String(JSON.parse(fs.readFileSync(p,"utf8")).version||"")}catch{return ""}};
const a=v(process.argv[1]),b=v(process.argv[2]);let c=0;
if(a&&b){const x=a.split("."),y=b.split(".");for(let i=0;i<Math.max(x.length,y.length)&&!c;i++){const p=parseInt(x[i]||"0",10),q=parseInt(y[i]||"0",10);if(Number.isNaN(p)||Number.isNaN(q))break;c=Math.sign(p-q)}}
if(c>0)process.stdout.write(a+" "+b)' "$1" "$2"
}
kept_modules=()
if [ "$pushback" = 1 ]; then
  install_modules=()
  for id in "${modules[@]}"; do
    vv="$(module_newer "$data/modules/$id/module.json" "Data/modules/$id/module.json")"
    if [ -n "$vv" ]; then
      kept_modules+=("$id")
      warn "module $id: the Pi has ${vv% *}, newer than the bundle's ${vv#* } (updated on the Pi after the backup): the Pi's copy is kept"
    else
      install_modules+=("$id")
    fi
  done
  modules=("${install_modules[@]}")
fi
assets=()
for d in Data/ddb-images Data/tokenizer; do [ -d "$d" ] && assets+=("${d#Data/}"); done
cd /

say "free space"
free_data="$(df --output=avail -B1 "$FOUNDRY_DATA" | tail -n1 | tr -d ' ')"
[ "$free_data" -gt $((bundle_size * 2)) ] || die "$FOUNDRY_DATA has $free_data bytes free, the install needs twice the bundle ($((bundle_size * 2)))"
ok "$free_data bytes free"
if [ "$pushback" = 1 ]; then
  # The change check copies the databases of the Pi's world and of the bundle's world into the work folder.
  need=0
  for d in "$data/worlds/$WORLD/data" "$data/worlds/$WORLD/packs" "$work/extract/Data/worlds/$WORLD/data" "$work/extract/Data/worlds/$WORLD/packs"; do
    if [ -d "$d" ]; then need=$((need + $(du -sb "$d" | cut -f1))); fi
  done
  free_import="$(df --output=avail -B1 "$IMPORT" | tail -n1 | tr -d ' ')"
  [ "$free_import" -gt "$need" ] || die "$IMPORT has $free_import bytes free, the change check's copies need $need. Nothing was changed"
  ok "room for the change check's copies ($need bytes)"
fi
# The world swap is a rename only on one filesystem; across two it copies (slower, and not atomic).
[ "$(stat -c %d "$IMPORT")" = "$(stat -c %d "$FOUNDRY_DATA")" ] ||
  warn "$IMPORT and $FOUNDRY_DATA are on different filesystems: the world swap copies instead of renaming"

say "owner and modes inside the work folder (755 folders, 644 files, owner $FOUNDRY_USER)"
chown -R "$FOUNDRY_USER:$FOUNDRY_USER" "$work/extract/Data"
find "$work/extract/Data" -type d -exec chmod 755 {} +
find "$work/extract/Data" -type f -exec chmod 644 {} +

if have_systemd; then
  # Remember what ran, so a failed run starts only that again.
  was_foundry=0
  was_gm_browser=0
  systemctl is-active --quiet foundry.service && was_foundry=1
  systemctl is-active --quiet foundry-ai-tool-gm-browser.service && was_gm_browser=1
  say "stopping the Assistant GM browser and Foundry"
  systemctl stop foundry-ai-tool-gm-browser.service 2>/dev/null || true
  systemctl stop foundry.service
  stopped=1
fi

# The push-back's change check (docs/dev/PLAN-B.md, "After the night", the rule for the push-back): the Pi's
# world must not hold a document created or changed after the Pi backup Plan B restored, or that work would be
# lost; REPLACE_NEWER=1 replaces it anyway (the old copy still goes to prev). Foundry is stopped, so the LevelDB
# is not in use; copies are scanned (opening a LevelDB writes to it) with Foundry's own classic-level. Only
# collection, name and time are printed. File times would not work: LevelDB rewrites its LOG and MANIFEST on
# every open. A document deleted on the Pi leaves no trace, so a delete alone is not seen. A newer Pi document
# with the same key and the same times in the bundle's world is the bundle's own (an earlier run of this
# push-back installed it and then failed, or the same world was pushed back before), so it does not count; nor
# do the documents this stage's own provisioning writes (the GM_USER and Assistant GM users, the bridge user
# setting), which a successful or late-failed earlier run changed on the Pi.
newer_count=0
same_count=0
scan_rc=0
check_state=none
if [ "$pushback" = 1 ]; then
  say "change check: did $WORLD on the Pi change after the Pi backup of $based_on?"
  if [ ! -d "$data/worlds/$WORLD" ]; then
    ok "there is no $WORLD on the Pi: nothing to compare"
  else
    for side in pi-world bundle-world; do
      src="$data/worlds/$WORLD"
      [ "$side" = pi-world ] || src="$work/extract/Data/worlds/$WORLD"
      install -d -m 700 "$work/$side"
      for sub in data packs; do
        [ ! -d "$src/$sub" ] || cp -a "$src/$sub" "$work/$side/$sub"
      done
    done
    find "$work/pi-world" "$work/bundle-world" -type f -name LOCK -delete
    assistant_name="$(
      # shellcheck disable=SC1090
      . "$assistant_env"
      printf '%s' "${ASSISTANT_GM_USER:-Assistant GM}"
    )"
    # The extra GM is one of this stage's own users too (EXTRA_GM_USER, or the one an earlier run gave the world).
    extra_name="${EXTRA_GM_USER:-$(env_extra_gm "$TOOL_ETC/world-$WORLD.env")}"
    node --input-type=module - "$FOUNDRY_APP/node_modules/classic-level" "$work/pi-world" "$work/bundle-world" "$based_on" \
      "$GM_USER" "$assistant_name" ${extra_name:+"$extra_name"} >"$work/changes" <<'NODE' || scan_rc=$?
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const [levelPath, piRoot, bundleRoot, since, ...provisioned] = process.argv.slice(2);
const sinceMs = Date.parse(since);
if (!Number.isFinite(sinceMs)) {
  console.error(`not a time: ${since}`);
  process.exit(1);
}
const { ClassicLevel } = createRequire(path.join(levelPath, 'noop.js'))(levelPath);
// Names only, short and printable: no document content leaves this script.
const clean = v => String(v ?? '').replace(/[^\p{L}\p{N} ._'()/:-]/gu, '?').slice(0, 60);
// Calls fn(sub, db name, key, doc, time) for every document newer than the snapshot; returns [docs, dbs].
async function scan(root, fn) {
  let docs = 0;
  let dbs = 0;
  for (const sub of ['data', 'packs']) {
    const dir = path.join(root, sub);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const db = path.join(dir, e.name);
      if (!e.isDirectory() || !existsSync(path.join(db, 'CURRENT'))) continue;
      dbs++;
      const level = new ClassicLevel(db, { createIfMissing: false, valueEncoding: 'utf8' });
      await level.open();
      try {
        for await (const [key, raw] of level.iterator()) {
          docs++;
          let doc;
          try {
            doc = JSON.parse(raw);
          } catch {
            continue;
          }
          const s = (doc && doc._stats) || {};
          const t = Math.max(Number(s.modifiedTime) || 0, Number(s.createdTime) || 0);
          if (t > sinceMs) fn(sub, e.name, key, doc, t, `${s.modifiedTime}|${s.createdTime}`);
        }
      } finally {
        await level.close();
      }
    }
  }
  return [docs, dbs];
}
const inBundle = new Map();
await scan(bundleRoot, (sub, db, key, doc, t, times) => inBundle.set(`${sub}/${db}/${key}`, times));
const newer = [];
let same = 0;
let own = 0;
const [docs, dbs] = await scan(piRoot, (sub, db, key, doc, t, times) => {
  if (
    sub === 'data' &&
    ((db === 'users' && provisioned.includes(doc.name)) ||
      (db === 'settings' && doc.key === 'foundry-mcp-bridge.bridgeUserId'))
  ) {
    own++;
    return;
  }
  if (inBundle.get(`${sub}/${db}/${key}`) === times) {
    same++;
    return;
  }
  const m = /^!([^!]+)!/.exec(key);
  const where = (sub === 'packs' ? `pack:${db}/` : '') + (m ? m[1] : db);
  const name = doc.name ?? doc.key ?? doc._id ?? key;
  newer.push({ t, line: `${clean(where)} ${clean(name)} ${new Date(t).toISOString()}` });
});
newer.sort((a, b) => b.t - a.t);
console.log(`${newer.length} ${docs} ${dbs} ${same} ${own}`);
for (const n of newer.slice(0, 5)) console.log(n.line);
process.exit(newer.length ? 3 : 0);
NODE
    read -r newer_count scanned_docs scanned_dbs same_count own_count <"$work/changes" || true
    newer_count="${newer_count:-0}" scanned_docs="${scanned_docs:-0}" scanned_dbs="${scanned_dbs:-0}"
    same_count="${same_count:-0}" own_count="${own_count:-0}"
    same_note=""
    [ "$same_count" = 0 ] || same_note="; $same_count newer ones are the same as in the bundle, from an earlier run of this push-back"
    [ "$own_count" = 0 ] || same_note="$same_note; $own_count newer ones are the users and setting this stage provisions"
    case "$scan_rc" in
      0)
        check_state=clean
        ok "nothing newer than $based_on ($scanned_docs documents in $scanned_dbs databases$same_note)"
        ;;
      3)
        check_state=newer
        warn "documents in the Pi's $WORLD created or changed after $based_on: $newer_count (newest first, up to 5; collection, name, time$same_note):"
        sed -n '2,6p' "$work/changes" | while IFS= read -r line; do printf '      %s\n' "$line" >&2; done
        if [ "$REPLACE_NEWER" = 1 ]; then
          warn "REPLACE_NEWER=1: the Pi's $WORLD is replaced anyway; its copy goes to $prev"
        else
          die "the Pi's $WORLD changed after the Pi backup Plan B restored: someone played or prepared on the Pi, and a push-back would lose that. Nothing was replaced. Ask the user; only with their OK to lose those changes run again with REPLACE_NEWER=1 (the Pi's copy is kept in $IMPORT/prev-<time> either way)"
        fi
        ;;
      *)
        check_state=failed
        if [ "$REPLACE_NEWER" = 1 ]; then
          warn "the change check could not read the Pi's $WORLD (exit $scan_rc, see above); REPLACE_NEWER=1, so the run goes on"
        else
          die "the change check could not read the Pi's $WORLD (exit $scan_rc, see above). Nothing was replaced"
        fi
        ;;
    esac
    rm -rf "${work:?}/pi-world" "${work:?}/bundle-world"
  fi
fi
install -d -m 700 "$prev"
store_prev() { # $1 path under $data, $2 name inside prev
  [ -e "$1" ] || return 0
  mkdir -p "$(dirname "$prev/$2")"
  mv "$1" "$prev/$2"
  ok "the old $(basename "$1") moved to $prev/$2"
}

say "modules"
install -d -m 755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$data/modules"
for id in "${modules[@]}"; do
  store_prev "$data/modules/$id" "modules/$id"
  mv "$work/extract/Data/modules/$id" "$data/modules/$id"
  ok "module $id installed"
done

say "asset folders (merged; existing files are never deleted, changed ones are saved to prev first)"
for a in "${assets[@]}"; do
  install -d -m 755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$data/$a"
  # Existing files with the same name and other content are kept in prev first, so nothing is lost.
  saved=0
  while IFS= read -r -d '' f; do
    if [ -f "$data/$f" ] && ! cmp -s "$work/extract/Data/$f" "$data/$f"; then
      mkdir -p "$prev/$(dirname "$f")"
      cp -a "$data/$f" "$prev/$f"
      saved=$((saved + 1))
    fi
  done < <(cd "$work/extract/Data" && find "$a" -type f -print0)
  cp -a "$work/extract/Data/$a/." "$data/$a/"
  ok "$a merged ($saved changed files saved to $prev first)"
done

say "worlds"
install -d -m 755 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$data/worlds"
todo=()
if [ -n "$KIT_WORLD" ]; then
  store_prev "$data/worlds/$KIT_WORLD" "worlds/$KIT_WORLD"
  cp -a "$work/extract/Data/worlds/$WORLD" "$data/worlds/$KIT_WORLD"
  node -e 'const fs=require("fs");const p=process.argv[1];const o=JSON.parse(fs.readFileSync(p,"utf8"));o.id=process.argv[2];o.title=process.argv[3];fs.writeFileSync(p,JSON.stringify(o,null,2)+"\n")' \
    "$data/worlds/$KIT_WORLD/world.json" "$KIT_WORLD" "$KIT_TITLE"
  ok "kit world $KIT_WORLD reset from the bundle"
  todo+=("$KIT_WORLD")
fi
real_state=installed
if [ -e "$data/worlds/$WORLD" ] && [ "$REPLACE_WORLD" != 1 ]; then
  real_state=kept
  warn "KEPT: the campaign world $WORLD already exists; it is never replaced without REPLACE_WORLD=1"
  # A kept world is provisioned again only for what it lacks: its GM login, or the extra GM's.
  if [ ! -f "$TOOL_ETC/world-$WORLD.env" ] ||
    { [ -n "$EXTRA_GM_USER" ] && ! grep -q '^EXTRA_GM_PASSWORD=' "$TOOL_ETC/world-$WORLD.env"; }; then
    todo+=("$WORLD")
  fi
else
  store_prev "$data/worlds/$WORLD" "worlds/$WORLD"
  mv "$work/extract/Data/worlds/$WORLD" "$data/worlds/$WORLD"
  world_swapped=1
  ok "world $WORLD installed"
  todo+=("$WORLD")
fi

# ---- provisioning: GM password file, options.json, Foundry, assistant-gm ------------------------------
new_password() { head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }
# /join answers 200 even when no world runs (an error page), so look for the join form's template.
world_up() { curl -fs http://127.0.0.1:30000/join 2>/dev/null | grep -q 'id="join-game"'; }
running=""
provision_world() { # $1 world id
  local id="$1" envf="$TOOL_ETC/world-$1.env"
  if [ -f "$envf" ]; then
    ok "$envf exists"
  else
    umask 077
    printf 'GM_USER="%s"\nGM_PASSWORD="%s"\n' "$GM_USER" "$(new_password)" >"$envf"
    umask 022
    chown root:root "$envf"
    chmod 600 "$envf"
    ok "wrote $envf"
  fi
  # The extra GM gets its own password in the same file, added once (the request check refused another name).
  if [ -n "$EXTRA_GM_USER" ] && ! grep -q '^EXTRA_GM_PASSWORD=' "$envf"; then
    umask 077
    printf 'EXTRA_GM_USER="%s"\nEXTRA_GM_PASSWORD="%s"\n' "$EXTRA_GM_USER" "$(new_password)" >>"$envf"
    umask 022
    ok "added the $EXTRA_GM_USER login to $envf"
  fi
  set_world "$id"
  if ! have_systemd; then
    warn "no systemd here (a test container?): $id is set in options.json but Foundry was not started and nothing was provisioned"
    return 0
  fi
  systemctl start foundry.service
  running="$id"
  local up=0
  for _ in $(seq 1 60); do
    if world_up; then
      up=1
      break
    fi
    sleep 2
  done
  [ "$up" = 1 ] || die "$id is not running on port 30000 (see: journalctl -u foundry -n 50)"
  ok "$id is running"
  (
    set -a
    # shellcheck disable=SC1090
    . "$assistant_env"
    # shellcheck disable=SC1090
    . "$envf"
    set +a
    runuser -u "$FOUNDRY_USER" -- env HOME="$TOOL_DATA" TOOL_APP="$TOOL_DIR/app" \
      FOUNDRY_URL=http://127.0.0.1:30000 CHROMIUM=/usr/bin/chromium \
      ASSISTANT_GM_USER="$ASSISTANT_GM_USER" ASSISTANT_GM_PASSWORD="$ASSISTANT_GM_PASSWORD" \
      PROVISION_GM_USER="$GM_USER" PROVISION_GM_PASSWORD="" PROVISION_GM_NEW_PASSWORD="$GM_PASSWORD" \
      PROVISION_EXTRA_GM_USER="${EXTRA_GM_USER:-}" PROVISION_EXTRA_GM_PASSWORD="${EXTRA_GM_PASSWORD:-}" \
      node "$TOOL_DIR/gm-browser/assistant-gm.mjs" provision
  ) || die "provisioning $id failed (see the lines above)"
  ok "$id provisioned"
}

say "provisioning (the world that launches goes last)"
ordered=()
for id in "${todo[@]}"; do [ "$id" = "$LAUNCH" ] || ordered+=("$id"); done
for id in "${todo[@]}"; do [ "$id" != "$LAUNCH" ] || ordered+=("$id"); done
for id in "${ordered[@]}"; do
  if [ "$id" != "$LAUNCH" ] && have_systemd; then
    provision_world "$id"
    systemctl stop foundry.service
    running=""
  else
    provision_world "$id"
  fi
done

say "Foundry launches $LAUNCH"
set_world "$LAUNCH"
ok "options.json launches $LAUNCH"
if have_systemd; then
  if [ "$running" != "$LAUNCH" ]; then
    systemctl restart foundry.service
    for _ in $(seq 1 60); do
      world_up && break
      sleep 2
    done
    world_up || die "$LAUNCH is not running on port 30000 (see: journalctl -u foundry -n 50)"
  fi
  enable_unit foundry-ai-tool-gm-browser.service
  for _ in $(seq 1 45); do
    journalctl -u foundry-ai-tool-gm-browser --since '-3 min' --no-pager | grep -q 'joined world' && break
    sleep 2
  done
  journalctl -u foundry-ai-tool-gm-browser -n 5 --no-pager | grep 'assistant-gm' || true
  # The bridge does not log connects, so look for the connection itself: an established TCP
  # connection on the bridge's Foundry port 31415 (the Assistant GM browser's module). A warning only.
  linked=0
  for _ in $(seq 1 15); do
    if [ -n "$(ss -Htn state established '( sport = :31415 )' 2>/dev/null)" ]; then
      linked=1
      break
    fi
    sleep 2
  done
  if [ "$linked" = 1 ]; then
    ok "a Foundry connection is established on the bridge's port 31415"
  else
    warn "no established connection on the bridge's port 31415 yet; see: journalctl -u foundry-ai-tool-gm-browser -n 30"
  fi
else
  warn "no systemd here (a test container?): Foundry and the Assistant GM browser were not started"
fi

say "cleaning up"
stopped=0
rm -rf "${work:?}"
trap - EXIT
rm -f "${BUNDLE:?}"
if [ -z "$(ls -A "$prev")" ]; then
  rmdir "$prev"
  prev_note="nothing was replaced, so there is no prev folder"
else
  prev_note="old copies kept in $prev ($(du -sh "$prev" | cut -f1)); remove them later, only with the user's OK"
fi

say "summary"
echo "    world $WORLD: $real_state"
if [ "$pushback" = 1 ]; then
  case "$check_state" in
    newer) echo "    push-back based on $based_on: $newer_count newer Pi documents replaced (REPLACE_NEWER=1; the Pi's copy is in prev)" ;;
    failed) echo "    push-back based on $based_on: the change check did not run (exit $scan_rc; REPLACE_NEWER=1; the Pi's copy is in prev)" ;;
    clean) echo "    push-back based on $based_on: nothing on the Pi was newer" ;;
    *) echo "    push-back based on $based_on: there was no $WORLD on the Pi to compare" ;;
  esac
fi
[ -z "$KIT_WORLD" ] || echo "    kit world $KIT_WORLD: reset ($KIT_TITLE)"
module_version() { node -e 'try{process.stdout.write(require(process.argv[1]).version||"")}catch{}' "$data/modules/$1/module.json"; }
for id in "${modules[@]}"; do
  echo "    module $id $(module_version "$id")"
done
for id in "${kept_modules[@]}"; do
  echo "    module $id $(module_version "$id") (the Pi's newer copy kept, not the bundle's)"
done
echo "    asset folders: ${assets[*]:-none}"
echo "    Foundry launches: $LAUNCH"
for id in "$WORLD" ${KIT_WORLD:+"$KIT_WORLD"}; do
  [ ! -f "$TOOL_ETC/world-$id.env" ] || echo "    GM password file for $id: $TOOL_ETC/world-$id.env (the GM reads it with: ssh foundry-pi cat $TOOL_ETC/world-$id.env)"
  extra="$(env_extra_gm "$TOOL_ETC/world-$id.env")"
  [ -z "$extra" ] || echo "    the extra GM $extra of $id: the same file, EXTRA_GM_PASSWORD"
done
echo "    $prev_note"
