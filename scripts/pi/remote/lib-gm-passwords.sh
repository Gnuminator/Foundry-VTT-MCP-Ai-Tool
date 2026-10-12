#!/usr/bin/env bash
# The GM password check (#273), a helper for stage 12 and gm-passwords.sh. It defines a function and runs
# nothing. It comes after lib.sh in the pipe:
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/lib-gm-passwords.sh scripts/pi/remote/<script> | ssh foundry-pi 'bash -s'
# (its own file so it does not touch lib.sh, which other lanes change).

# Read-only (#273): lists, for every world in $FOUNDRY_DATA/Data/worlds, the Gamemaster and Assistant GM
# users who log in with an empty password. Stage 12 refuses to open the tunnel while one exists;
# gm-passwords.sh runs it on its own (both need this file in the pipe). Foundry 14 keeps a PBKDF2 hash of every password, an empty one too,
# so a user has none when the empty password matches the hash (as Foundry's own login tests it), or when an
# old plaintext record has no salt and an empty password. A world with no Gamemaster counts too (one never
# launched has no users database): its next launch creates a "Gamemaster" with no password. Each world's users
# database is copied to a root-only folder in /tmp and read there with Foundry's own classic-level (opening a
# LevelDB writes to it, and Foundry holds the running world's); the copy is removed afterwards. Prints world
# ids, user names and roles only, never a hash or salt.
# Returns 0 when there is none, 3 when there is one or more, 1 when a world could not be read.
gm_password_check() {
  local worlds="$FOUNDRY_DATA/Data/worlds" level="$FOUNDRY_APP/node_modules/classic-level"
  local work rc=0 dir id
  if [ ! -d "$worlds" ]; then
    ok "no worlds folder ($worlds): no world to check"
    return 0
  fi
  [ -x "$NODE_DIR/bin/node" ] || {
    printf 'ERROR: Node is missing (%s): cannot read the worlds\n' "$NODE_DIR/bin/node" >&2
    return 1
  }
  [ -d "$level" ] || {
    printf 'ERROR: Foundry'"'"'s classic-level is missing (%s): cannot read the worlds\n' "$level" >&2
    return 1
  }
  work="$(mktemp -d /tmp/gm-password-check.XXXXXX)" || return 1
  chmod 700 "$work"
  for dir in "$worlds"/*/; do
    [ -f "$dir/world.json" ] || continue
    id="$(basename "$dir")"
    mkdir -p "$work/$id"
    if [ -d "$dir/data/users" ]; then
      cp -a "$dir/data/users" "$work/$id/users" || {
        printf 'ERROR: could not copy the users database of %s\n' "$id" >&2
        rc=1
      }
    fi
  done
  find "${work:?}" -type f -name LOCK -delete
  if [ "$rc" = 0 ]; then
    "$NODE_DIR/bin/node" --input-type=module - "$level" "$work" <<'NODE' || rc=$?
import { existsSync, readdirSync } from 'node:fs';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const [levelPath, root] = process.argv.slice(2);
const { ClassicLevel } = createRequire(path.join(levelPath, 'noop.js'))(levelPath);
const ROLES = { 3: 'Assistant GM', 4: 'Gamemaster' };
// Names only, short and printable: no other user data leaves this script.
const clean = v => String(v ?? '').replace(/[^\p{L}\p{N} ._'()/:-]/gu, '?').slice(0, 60);
// Foundry's testPassword (dist/core/auth.mjs) with the empty password.
function noPassword(user) {
  const hash = typeof user.password === 'string' ? user.password : '';
  if (typeof user.passwordSalt !== 'string') return hash === '';
  const stored = Buffer.from(hash, 'hex');
  const empty = pbkdf2Sync('', user.passwordSalt, 1000, 64, 'sha512');
  return stored.length === empty.length && timingSafeEqual(stored, empty);
}
let found = 0;
let failed = 0;
for (const id of readdirSync(root).sort()) {
  const db = path.join(root, id, 'users');
  if (!existsSync(db)) {
    found++;
    console.log(`    FOUND: ${clean(id)}: never launched (no users database); its first launch makes a Gamemaster with no password`);
    continue;
  }
  const level = new ClassicLevel(db, { createIfMissing: false, valueEncoding: 'utf8' });
  const users = [];
  try {
    await level.open();
    for await (const [, raw] of level.iterator()) users.push(JSON.parse(raw));
  } catch (e) {
    failed++;
    console.error(`ERROR: ${clean(id)}: the users database could not be read (${clean(e?.message)})`);
    continue;
  } finally {
    await level.close().catch(() => {});
  }
  const gms = users.filter(u => ROLES[u?.role]);
  const open = gms.filter(noPassword).map(u => `${ROLES[u.role]} "${clean(u.name)}"`);
  // Foundry's world launch (World#setup) makes sure a Gamemaster exists: with none, it promotes a user named
  // "Gamemaster" (who keeps their password) or creates a new "Gamemaster" with no password.
  if (!users.some(u => u?.role === 4)) {
    const named = users.find(u => u?.name === 'Gamemaster');
    if (!named) open.push('no Gamemaster: its next launch creates a Gamemaster with no password');
    else if (noPassword(named) && !ROLES[named.role]) open.push('no Gamemaster: its next launch promotes "Gamemaster", who has no password');
  }
  if (open.length) {
    found += open.length;
    for (const u of open) console.log(`    FOUND: ${clean(id)}: ${u.startsWith('no Gamemaster') ? u : `${u} has no password`}`);
  } else {
    console.log(`    ok: ${clean(id)}: every Gamemaster and Assistant GM has a password (${gms.length})`);
  }
}
process.exitCode = failed ? 1 : found ? 3 : 0;
NODE
  fi
  rm -rf "${work:?}"
  return "$rc"
}
