#!/usr/bin/env bash
# Stage 2: Node.js 24 LTS for ARM64 from nodejs.org, checked against SHASUMS256.txt (Foundry 14
# needs Node 24). Installs into /opt/node24; a newer 24.x replaces the old one.

require_root
require_arm64

say "Node.js 24"
base=https://nodejs.org/dist/latest-v24.x
sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "could not fetch $base/SHASUMS256.txt"
file="$(printf '%s\n' "$sums" | awk '/ node-v24\.[0-9]+\.[0-9]+-linux-arm64\.tar\.xz$/ { print $2 }' | head -n1)"
[ -n "$file" ] || die "no linux-arm64 tarball in SHASUMS256.txt"
want="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1 }')"
version="${file#node-}"
version="${version%-linux-arm64.tar.xz}"

if [ -x "$NODE_DIR/bin/node" ] && [ "$("$NODE_DIR/bin/node" --version)" = "$version" ]; then
  ok "Node $version already installed"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/$file" "$base/$file"
  got="$(sha256sum "$tmp/$file" | awk '{ print $1 }')"
  [ "$got" = "$want" ] || die "checksum mismatch for $file (expected $want, got $got)"
  ok "downloaded $file, checksum matches"
  rm -rf "${NODE_DIR:?}"/*
  tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  ok "installed Node $version in $NODE_DIR"
fi

ln -sf "$NODE_DIR/bin/node" /usr/local/bin/node
ln -sf "$NODE_DIR/bin/npm" /usr/local/bin/npm
ln -sf "$NODE_DIR/bin/npx" /usr/local/bin/npx
ok "node $(node --version), npm $(npm --version) on the PATH"

say "stage 2 done"
