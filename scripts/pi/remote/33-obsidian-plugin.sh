#!/usr/bin/env bash
# Stage 33: the Obsidian plugin through the GM vault (backlog obsidian-plugin-via-vault). The release's plugin files
# (main.js, manifest.json, styles.css) are written into the GM vault on the Pi, .obsidian/plugins/foundry-ai-tool, and
# Syncthing carries exactly those three files to every PC that holds the vault, so the GM's plugin follows the Pi's version
# with no hand step (Obsidian loads the new files after a restart). The plugin's data.json, which holds the dashboard
# settings and the GM token, is never written, read or synced: only the three named files are let through the ignore list.
#
# The files come from the tool build stage 5 installed ($TOOL_DIR/app/packages/obsidian-plugin/dist, the same files as the
# release zip foundry-ai-tool-obsidian.zip), so run this after stage 5 on each new release. PLUGIN_SRC=<dir> names another source.
#
# Modes (environment, before bash):
#   (none)     write the three files when they differ from the build's, and make sure the vault's .stignore lets exactly these
#              files through (the "!" lines sit above ".obsidian/plugins", Syncthing uses the first line that matches).
#              Needs a dietpi-backup snapshot from today and the user's OK. Nothing restarts.
#   CHECK=1    read-only, any time: says what is in the vault, what the build has and whether the ignore list is right;
#              exit 0 when the vault holds the build's files and the ignore list is right, exit 1 otherwise. Needs no snapshot.
# It never deletes anything in the vault, and never touches data.json or any other file in the plugin's folder.
# Run from the PC (bash, not PowerShell):
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/33-obsidian-plugin.sh | ssh foundry-pi 'CHECK=1 bash -s'
#   cat scripts/pi/remote/lib.sh scripts/pi/remote/33-obsidian-plugin.sh | ssh foundry-pi 'bash -s'

require_root
export PATH="$NODE_DIR/bin:$PATH"

check="${CHECK:-0}"
src="${PLUGIN_SRC:-$TOOL_DIR/app/packages/obsidian-plugin/dist}"
gm_dir="$TOOL_DATA/obsidian/gm"
plugin_dir="$gm_dir/.obsidian/plugins/foundry-ai-tool"
stignore_file="$gm_dir/.stignore"
files="main.js manifest.json styles.css"
include_lines="!.obsidian/plugins/foundry-ai-tool/main.js
!.obsidian/plugins/foundry-ai-tool/manifest.json
!.obsidian/plugins/foundry-ai-tool/styles.css"

case "$check" in 0 | 1) ;; *) die "CHECK is 0 or 1" ;; esac
id "$FOUNDRY_USER" >/dev/null 2>&1 || die "the $FOUNDRY_USER user is missing: run stage 1 first"
[ -d "$gm_dir" ] || die "the GM vault $gm_dir is missing: run stage 7 first"
[ -x "$NODE_DIR/bin/node" ] || die "Node is missing: run stage 2 first"
if [ "$check" != 1 ]; then
  require_recent_snapshot
  # A dropped SSH session must not stop a change halfway.
  trap '' HUP PIPE
fi

say "the plugin build"
for f in $files; do
  [ -s "$src/$f" ] || die "the build has no $src/$f: run stage 5 first (or PLUGIN_SRC=<dir> names another build)"
done
# The plugin id decides the folder name Obsidian loads it from; a wrong or missing manifest would write a dead folder.
plugin_id="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id' "$src/manifest.json" 2>/dev/null || true)"
[ "$plugin_id" = foundry-ai-tool ] || die "$src/manifest.json is not the Foundry AI Tool plugin (id '${plugin_id:-unreadable}')"
version="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$src/manifest.json")"
ok "plugin $plugin_id $version in $src"

differs() { ! cmp -s "$src/$1" "$plugin_dir/$1"; }
need_files=""
for f in $files; do
  if [ -f "$plugin_dir/$f" ] && ! differs "$f"; then ok "$f is already the build's"; else need_files="$need_files $f"; fi
done

# stignore_ok: every include line is in the vault's .stignore, above the ".obsidian/plugins" line.
stignore_ok() {
  [ -f "$stignore_file" ] || return 1
  awk -v inc="$include_lines" '
    BEGIN { n = split(inc, want, "\n"); }
    { line[NR] = $0 }
    END {
      stop = 0
      for (i = 1; i <= NR; i++) if (line[i] == ".obsidian/plugins") { stop = i; break }
      for (w = 1; w <= n; w++) {
        found = 0
        for (i = 1; i <= NR; i++) if (line[i] == want[w] && (stop == 0 || i < stop)) { found = 1; break }
        if (!found) exit 1
      }
    }' "$stignore_file"
}

say "the vault's ignore list"
if stignore_ok; then
  ok "$stignore_file lets the three plugin files through"
  need_ignore=0
else
  need_ignore=1
  warn "$stignore_file does not let the three plugin files through yet"
fi

if [ "$check" = 1 ]; then
  say "what the vault holds"
  for f in $files; do
    if [ ! -f "$plugin_dir/$f" ]; then
      echo "    $f: missing in the vault"
    elif differs "$f"; then
      echo "    $f: differs from the build"
    else
      echo "    $f: same as the build"
    fi
  done
  [ -e "$plugin_dir/data.json" ] && warn "$plugin_dir/data.json exists on the Pi: it is not synced, but the token should not be kept in the Pi's vault; delete it by hand if no one needs it"
  if [ -z "$need_files" ] && [ "$need_ignore" = 0 ]; then
    say "stage 33 check: the vault holds plugin $version and the ignore list is right"
    exit 0
  fi
  say "stage 33 check: not in step (run this stage without CHECK=1 after a snapshot and the user's OK)"
  exit 1
fi

# ---- changes start here --------------------------------------------------------------------------------------------
if [ "$need_ignore" = 1 ]; then
  say "writing the ignore list"
  tmp="$stignore_file.foundry-tmp"
  # The "!" lines go right above ".obsidian/plugins" (or at the end when the line is not there); lines already in
  # the file stay as they are, and a "!" line that is already there is not added twice.
  awk -v inc="$include_lines" '
    BEGIN { n = split(inc, want, "\n") }
    { line[NR] = $0 }
    END {
      stop = 0
      for (i = 1; i <= NR; i++) if (line[i] == ".obsidian/plugins") { stop = i; break }
      for (i = 1; i <= NR; i++) {
        # drop a copy of an include line that sits below the ignore line, where it would never match
        drop = 0
        if (stop > 0 && i > stop) for (w = 1; w <= n; w++) if (line[i] == want[w]) drop = 1
        if (i == stop) for (w = 1; w <= n; w++) { have = 0; for (j = 1; j < stop; j++) if (line[j] == want[w]) have = 1; if (!have) print want[w] }
        if (!drop) print line[i]
      }
      if (stop == 0) for (w = 1; w <= n; w++) print want[w]
    }' "$stignore_file" >"$tmp" || die "could not build the new ignore list"
  chmod 0640 "$tmp"
  chown "$FOUNDRY_USER:$FOUNDRY_USER" "$tmp"
  mv -f "$tmp" "$stignore_file"
  stignore_ok || die "the ignore list is still not right after writing it (see $stignore_file)"
  ok "$stignore_file now lets exactly the three plugin files through"
fi

say "the plugin files"
if [ -z "$need_files" ]; then
  ok "nothing to write: the vault already holds plugin $version"
else
  install -d -m 0750 -o "$FOUNDRY_USER" -g "$FOUNDRY_USER" "$gm_dir/.obsidian" "$gm_dir/.obsidian/plugins" "$plugin_dir"
  for f in $need_files; do
    # Written beside the target under a name the ignore list does not let through (so Syncthing never sees it), then moved
    # into place in one step: Obsidian and Syncthing never read a half-written main.js.
    tmp="$plugin_dir/.$f.foundry-tmp"
    cp "$src/$f" "$tmp"
    chmod 0640 "$tmp"
    chown "$FOUNDRY_USER:$FOUNDRY_USER" "$tmp"
    mv -f "$tmp" "$plugin_dir/$f"
    ok "wrote $plugin_dir/$f"
  done
fi
[ -e "$plugin_dir/data.json" ] && warn "$plugin_dir/data.json exists on the Pi: it is not synced and this stage left it alone"
for f in $files; do
  cmp -s "$src/$f" "$plugin_dir/$f" || die "$plugin_dir/$f is not the build's after the write"
done
say "stage 33 done: the GM vault holds plugin $version. Syncthing carries the three files to the PCs; Obsidian loads the new version after a restart"
