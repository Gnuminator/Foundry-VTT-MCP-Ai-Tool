#!/usr/bin/env bash
# Stage 2: Node.js 24 LTS for ARM64 from nodejs.org, checked against SHASUMS256.txt (Foundry 14
# needs Node 24). Installs into /opt/node24. The version is pinned below (NODE_VERSION): a rerun never
# floats to a newer 24.x by itself. To move to another version, change the pin here (or run once with
# NODE_VERSION=v24.x.y in front of bash), after the user's OK and a snapshot like any other stage.
# The new version is unpacked next to the old one and swapped in with two renames, so a failure never
# leaves /opt/node24 empty; the old one stays as /opt/node24.prev for a quick rollback. The running
# services keep the old binary until they restart (stage 2 restarts nothing).

require_root
require_recent_snapshot
require_arm64

NODE_VERSION="${NODE_VERSION:-v24.21.0}"
printf '%s' "$NODE_VERSION" | grep -Eq '^v24\.[0-9]+\.[0-9]+$' || die "NODE_VERSION must look like v24.21.0, got '$NODE_VERSION'"

say "Node.js $NODE_VERSION"
base="https://nodejs.org/dist/$NODE_VERSION"
file="node-$NODE_VERSION-linux-arm64.tar.xz"
sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "could not fetch $base/SHASUMS256.txt"
want="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1 }')"
[ -n "$want" ] || die "no $file in SHASUMS256.txt"

if [ -x "$NODE_DIR/bin/node" ] && [ "$("$NODE_DIR/bin/node" --version)" = "$NODE_VERSION" ]; then
  ok "Node $NODE_VERSION already installed"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' EXIT
  curl -fsSL -o "$tmp/$file" "$base/$file"
  got="$(sha256sum "$tmp/$file" | awk '{ print $1 }')"
  [ "$got" = "$want" ] || die "checksum mismatch for $file (expected $want, got $got)"
  ok "downloaded $file, checksum matches"
  new="${NODE_DIR:?}.new"
  rm -rf "${new:?}"
  mkdir -p "$new"
  tar -xJf "$tmp/$file" -C "$new" --strip-components=1
  [ -x "$new/bin/node" ] || die "the unpacked Node has no bin/node; $NODE_DIR was not touched"
  [ "$("$new/bin/node" --version)" = "$NODE_VERSION" ] || die "the unpacked Node is not $NODE_VERSION; $NODE_DIR was not touched"
  rm -rf "${NODE_DIR:?}.prev"
  [ -d "$NODE_DIR" ] && mv "$NODE_DIR" "$NODE_DIR.prev"
  mv "$new" "$NODE_DIR"
  ok "installed Node $NODE_VERSION in $NODE_DIR (the old one: $NODE_DIR.prev)"
fi

ln -sf "$NODE_DIR/bin/node" /usr/local/bin/node
ln -sf "$NODE_DIR/bin/npm" /usr/local/bin/npm
ln -sf "$NODE_DIR/bin/npx" /usr/local/bin/npx
ok "node $(node --version), npm $(npm --version) on the PATH"

say "stage 2 done"
