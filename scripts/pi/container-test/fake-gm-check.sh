#!/usr/bin/env bash
# Sourced by the stage 11 and stage 13 scenario scripts (not run on its own): the stand-ins that let the closing GM
# password check (gm_passwords_notice in scripts/pi/remote/lib-gm-passwords.sh) run in a container without
# Foundry's LevelDB. A fake classic-level reads a fixture.json from the "database" folder (the same idea as
# scripts/pi/gm-passwords.test.mjs). Needs FOUNDRY_APP and FOUNDRY_DATA from lib.sh, and the Debian node.

# Installs the fake classic-level where gm_password_check looks for Foundry's.
fake_classic_level() {
  local d="$FOUNDRY_APP/node_modules/classic-level"
  mkdir -p "$d"
  echo '{"name":"classic-level","version":"0.0.0","main":"index.js"}' >"$d/package.json"
  cat >"$d/index.js" <<'JS'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
class ClassicLevel {
  constructor(dir) {
    this.dir = dir;
    this.entries = [];
  }
  async open() {
    this.entries = JSON.parse(fs.readFileSync(path.join(this.dir, 'fixture.json'), 'utf8'));
  }
  async *iterator() {
    for (const e of this.entries) yield [e[0], e[1]];
  }
  async close() {}
}
module.exports = { ClassicLevel };
JS
}

# World $1 gets a users database with one Gamemaster. $2 is its password; empty means no password.
fake_gm_user() {
  local dir="$FOUNDRY_DATA/Data/worlds/$1/data/users"
  mkdir -p "$dir"
  node -e '
const { pbkdf2Sync } = require("node:crypto");
const salt = "00112233445566778899aabbccddeeff";
const user = { _id: "u0000000000000001", name: "Gamemaster", role: 4, passwordSalt: salt,
  password: pbkdf2Sync(process.argv[2], salt, 1000, 64, "sha512").toString("hex") };
require("node:fs").writeFileSync(process.argv[1] + "/fixture.json", JSON.stringify([["!users!" + user._id, JSON.stringify(user)]]));
' "$dir" "$2"
}

# An administrator password the way Foundry keeps it: a hash in Config/admin.txt (the check only looks at the size).
fake_admin_password() {
  mkdir -p "$FOUNDRY_DATA/Config"
  printf '%s\n' 0123456789abcdef0123456789abcdef >"$FOUNDRY_DATA/Config/admin.txt"
}
