#!/usr/bin/env bash
# The Pi's "Who uses what" reading (backlog who-uses-what-pi-job). Installed by scripts/pi/remote/35-who-uses-what.sh and run by
# foundry-ai-tool-who-uses-what.timer (every 4 hours and Sunday 23:00) as the foundry user. One run:
#   1. asks the Pi dashboard for the report and renders it with who-uses-what.mjs (counts and names only);
#   2. fetches the newest commit of the vault repo (depth 1, one sparse file: the Pi never holds the rest of the vault);
#   3. writes "Dev/Foundry AI Tool/Who uses what.md" there and pushes it with the deploy key; a rejected push (the PC pushed
#      first) fetches again and tries once more. An unchanged note makes no commit.
# Nothing it prints holds a token, a key or an address with a query string.
#
# Environment (the unit sets the first three from the stage; the rest are for tests):
#   WUW_DIR        state folder (key, known_hosts, the sparse clone); default /var/lib/foundry-ai-tool/who-uses-what
#   WUW_NODE       the node binary; default /opt/node24/bin/node
#   WUW_SCRIPT     who-uses-what.mjs; default /opt/foundry-ai-tool/who-uses-what/who-uses-what.mjs
#   WUW_DASHBOARD  the dashboard address; default http://127.0.0.1:3000
#   WUW_REMOTE     the vault repo; default git@github.com:Gnuminator/obsidian-vault.git
#   WUW_BRANCH     default main
#   WUW_DAYS       the window in days; default 7
#   GM_DASHBOARD_TOKEN  from dashboard-access.env (the unit's EnvironmentFile); sent to the dashboard only
#   WUW_MODE=check  read the report and list the vault's remote (read-only: no clone, no write, no push); the stage's CHECK=1
#   WUW_SSH_PLAIN=1  tests only: no ssh options (a local path as the remote)
set -euo pipefail
umask 077

dir="${WUW_DIR:-/var/lib/foundry-ai-tool/who-uses-what}"
node_bin="${WUW_NODE:-/opt/node24/bin/node}"
script="${WUW_SCRIPT:-/opt/foundry-ai-tool/who-uses-what/who-uses-what.mjs}"
dash="${WUW_DASHBOARD:-http://127.0.0.1:3000}"
remote="${WUW_REMOTE:-git@github.com:Gnuminator/obsidian-vault.git}"
branch="${WUW_BRANCH:-main}"
days="${WUW_DAYS:-7}"
note_path="Dev/Foundry AI Tool/Who uses what.md"
repo="$dir/repo"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp:?}"' EXIT

say() { echo "who-uses-what: $*"; }
fail() { echo "who-uses-what: $*" >&2; exit 1; }

[ -x "$node_bin" ] || fail "node is missing at $node_bin"
[ -f "$script" ] || fail "$script is missing: run stage 35 again"
command -v git >/dev/null 2>&1 || fail "git is missing"
mkdir -p "$dir"

export HOME="$dir"
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
if [ "${WUW_SSH_PLAIN:-0}" != 1 ]; then
  [ -f "$dir/id_ed25519" ] || fail "the deploy key $dir/id_ed25519 is missing: run stage 35 again"
  export GIT_SSH_COMMAND="ssh -i $dir/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$dir/known_hosts -o ConnectTimeout=20"
fi

# The stage's CHECK gives the env file instead of the token (a token on a command line shows in the process list).
if [ -n "${WUW_ENV_FILE:-}" ] && [ -f "$WUW_ENV_FILE" ] && [ -z "${GM_DASHBOARD_TOKEN:-}" ]; then
  GM_DASHBOARD_TOKEN="$(sed -n 's/^[[:space:]]*GM_DASHBOARD_TOKEN=//p' "$WUW_ENV_FILE" | tail -n 1)"
fi

say "reading the report from the dashboard"
COGM_TOKEN="${GM_DASHBOARD_TOKEN:-}" "$node_bin" "$script" --base "$dash" --days "$days" --out "$tmp/note.md" >/dev/null ||
  fail "the dashboard gave no report (is it running, and does dashboard-access.env hold GM_DASHBOARD_TOKEN?)"
head -n 1 "$tmp/note.md" | grep -q '^# Who uses what$' || fail "the report does not look like the note (first line)"

if [ "${WUW_MODE:-}" = check ]; then
  say "the report is readable ($(wc -c <"$tmp/note.md") bytes)"
  git ls-remote --exit-code "$remote" "refs/heads/$branch" >/dev/null || fail "the vault repo does not answer with this key (add it as a deploy key)"
  say "the vault repo answers for $branch"
  exit 0
fi

g() { git -C "$repo" -c user.name=foundry-pi -c user.email=foundry-pi@users.noreply.github.com "$@"; }

if [ ! -d "$repo/.git" ]; then
  say "first run: preparing the sparse clone (one file of the vault)"
  rm -rf "${repo:?}"
  mkdir -p "$repo"
  git -C "$repo" init -q -b "$branch"
  git -C "$repo" remote add origin "$remote"
  git -C "$repo" config core.sparseCheckout true
  # Blobless: a depth-1 fetch brings the trees (file names) but not the other notes' content; checkout fetches only the one file.
  git -C "$repo" config remote.origin.promisor true
  git -C "$repo" config remote.origin.partialclonefilter blob:none
  printf '/%s\n' "$note_path" >"$repo/.git/info/sparse-checkout"
fi
# The remote may have been fixed in a later stage run.
git -C "$repo" remote set-url origin "$remote"

# A run killed mid-git leaves a lock that would stop every later run; runs never overlap (oneshot), so removing it is safe.
rm -f "${repo:?}/.git/index.lock" "${repo:?}/.git/shallow.lock"
# Old shallow tips and loose objects of earlier runs are dropped, so the clone does not grow for ever.
git -C "$repo" gc -q --prune=now 2>/dev/null || true

attempt=0
while :; do
  attempt=$((attempt + 1))
  say "fetching $branch (depth 1)"
  g fetch -q --depth 1 --filter=blob:none origin "$branch" || fail "git fetch failed (deploy key not added to the vault repo, or no network)"
  g checkout -q -f -B "$branch" "origin/$branch" >/dev/null 2>&1 || g reset -q --hard "origin/$branch"
  mkdir -p "$(dirname "$repo/$note_path")"
  cp "$tmp/note.md" "$repo/$note_path"
  g add -- "$note_path"
  if g diff --cached --quiet; then
    say "the note is unchanged: nothing to push"
    exit 0
  fi
  g commit -q -m "Who uses what: Pi reading $(date -u +%Y-%m-%dT%H:%MZ)"
  if g push -q origin "HEAD:$branch"; then
    say "pushed the note ($(wc -c <"$tmp/note.md") bytes)"
    exit 0
  fi
  [ "$attempt" -lt 2 ] || fail "git push was refused twice (the deploy key needs write access to the vault repo, or main is protected)"
  say "push refused (the vault moved): trying once more"
done
