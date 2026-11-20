#!/usr/bin/env bash
# Stage 33: the Obsidian plugin through the GM vault (backlog obsidian-plugin-via-vault). The release's plugin files
# (main.js, manifest.json, styles.css) are written into the GM vault on the Pi, .obsidian/plugins/foundry-ai-tool, and
# Syncthing carries exactly those three files to every PC that holds the vault, so the GM's plugin follows the Pi's version
# with no hand step (Obsidian loads the new files after a restart). The plugin's data.json (its per-PC
# settings) is never written, read or synced: only the three named files are let through the ignore list. Every write into
# the vault runs as the foundry user, which owns it (lib.sh: root must not follow a link left there).
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
# It deletes nothing in the vault (only its own leftover temp file is removed), and never touches data.json or any other file in the plugin's folder.
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
        for (i = 1; i <= NR; i++) if (line[i] == want[w] && stop > 0 && i < stop) { found = 1; break }
        if (!found) exit 1
      }
    }' "$stignore_file"
}
# has_plugins_line: the exact line ".obsidian/plugins" is in the vault's .stignore (stage 7 writes it). Without it the whole
# plugins folder would sync, data.json included, so this stage refuses to go on rather than guess.
has_plugins_line() { [ -f "$stignore_file" ] && grep -qx '\.obsidian/plugins' "$stignore_file"; }

# Writes into the vault run as the foundry user, which owns it and receives changes from Syncthing peers: root must not follow
# a link left at a name here (lib.sh, "Writes into folders the foundry user owns"). Links are refused up front.
refuse_links() {
  local p
  for p in "$gm_dir/.stignore" "$gm_dir/.obsidian" "$gm_dir/.obsidian/plugins" "$plugin_dir" "$plugin_dir/main.js" \
    "$plugin_dir/manifest.json" "$plugin_dir/styles.css"; do
    [ ! -L "$p" ] || die "$p is a link: refused (nothing was written)"
  done
}

say "the vault's ignore list"
if ! has_plugins_line; then
  if [ "$check" = 1 ]; then
    warn "$stignore_file has no .obsidian/plugins line: the plugins folder would sync whole (data.json too); run stage 7 again"
  else
    die "$stignore_file has no .obsidian/plugins line: refused (the plugins folder would sync whole, data.json too). Run stage 7 again, nothing was written"
  fi
  need_ignore=1
elif stignore_ok; then
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
  [ -e "$plugin_dir/data.json" ] && warn "$plugin_dir/data.json exists on the Pi: it is the plugin's per-PC settings, never synced, and not needed on the Pi"
  if [ -z "$need_files" ] && [ "$need_ignore" = 0 ]; then
    say "stage 33 check: the vault holds plugin $version and the ignore list is right"
    exit 0
  fi
  say "stage 33 check: not in step (run this stage without CHECK=1 after a snapshot and the user's OK)"
  exit 1
fi

# ---- changes start here --------------------------------------------------------------------------------------------
refuse_links
# The folders first (as the foundry user): the ignore list's temp file lives in .obsidian/plugins, which the ignore list
# covers, so a half-written temp file is never offered to a PC.
# Every folder this makes (.obsidian, plugins, the plugin's own) is 0750 like the vault; one that already exists keeps its mode.
runuser -u "$FOUNDRY_USER" -- sh -c 'for d in "$1/.obsidian" "$1/.obsidian/plugins" "$2"; do [ -d "$d" ] || mkdir -m 0750 "$d" || exit 1; done' sh \
  "$gm_dir" "$plugin_dir" || die "could not make $plugin_dir as $FOUNDRY_USER"
if [ "$need_ignore" = 1 ]; then
  say "writing the ignore list"
  # The "!" lines go right above ".obsidian/plugins"; lines already in the file stay as they are, and a "!" line that is
  # already there is not added twice. The line itself is known to be there (has_plugins_line, above).
  new_ignore="$(awk -v inc="$include_lines" '
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
    }' "$stignore_file" |
    runuser -u "$FOUNDRY_USER" -- sh -c 't="$2"; rm -f "$t" && cat >"$t" && chmod 0640 "$t" && mv -f "$t" "$1"' sh \
      "$stignore_file" "$gm_dir/.obsidian/plugins/.stignore.foundry-tmp" || die "could not write the new ignore list (nothing else was changed)"
  stignore_ok || die "the ignore list is still not right after writing it (see $stignore_file)"
  ok "$stignore_file now lets exactly the three plugin files through"
fi

say "the plugin files"
if [ -z "$need_files" ]; then
  ok "nothing to write: the vault already holds plugin $version"
else
  for f in $need_files; do
    # Written as the foundry user beside the target under a name the ignore list does not let through (so Syncthing never
    # sees it), then moved into place in one step: Obsidian and Syncthing never read a half-written main.js.
    runuser -u "$FOUNDRY_USER" -- sh -c 't="$2.foundry-tmp"; rm -f "$t" && cp "$1" "$t" && chmod 0640 "$t" && mv -f "$t" "$2"' sh \
      "$src/$f" "$plugin_dir/$f" || die "could not write $plugin_dir/$f"
    ok "wrote $plugin_dir/$f"
  done
fi
[ -e "$plugin_dir/data.json" ] && warn "$plugin_dir/data.json exists on the Pi: it is not synced and this stage left it alone"
for f in $files; do
  cmp -s "$src/$f" "$plugin_dir/$f" || die "$plugin_dir/$f is not the build's after the write"
done
say "stage 33 done: the GM vault holds plugin $version. Syncthing carries the three files to the PCs; Obsidian loads the new version after a restart"
