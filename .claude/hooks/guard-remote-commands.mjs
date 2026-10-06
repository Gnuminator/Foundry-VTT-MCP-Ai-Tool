#!/usr/bin/env node
// PreToolUse guard for commands that reach another machine (Claude Code hook).
//
// The user's rule for the Orange Pi and any Linux host (2026-10-04, CLAUDE.md "Critical rules"):
// read-only commands freely, changes only from reviewed stage scripts after an OK, and a fixed list
// of dangerous actions needs the user's explicit OK every time. This hook makes that list
// mechanical: it reads every Bash or PowerShell command that uses ssh, scp, sftp or rsync, plus the
// local script files fed into it (`< file`, `cat a b |`, `*.sh` arguments), and
//   - denies what can wreck the machine outright (deleting / or a system folder, formatting or
//     overwriting a disk, recursive permission changes on system folders, removing root), and
//   - asks the user for everything else on the dangerous list (users and groups, partitions,
//     removing packages, reboots, firewall, SSH and network settings, critical files in /etc,
//     recursive deletes outside our own folders, `find -delete`, `xargs rm`).
// It cannot be talked out of a decision: it is code, not judgement. A false alarm only costs a
// confirmation click.
//
// Every check runs in linear time: a hook that passes its timeout fails open, so a long crafted
// command must not slow it down. Where one regex would re-read the rest of the line from every
// possible start (`rm -rm -rm ...`), the search reads each stretch once and moves on.
//
// Reads the hook payload (JSON) on stdin; prints a decision or nothing (allow).

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REMOTE = /(^|[\s;&|(])(ssh|scp|sftp|rsync|plink)(\.exe)?(?=\s|$)/;

// Folders the stage scripts own; recursive deletes below them are allowed.
const OWN_PREFIXES = [
  '/tmp/',
  '/opt/foundry',
  '/opt/node24',
  '/opt/foundry-ai-tool',
  '/var/lib/foundry',
  '/etc/foundry-ai-tool',
];
const SYSTEM_DIRS =
  'bin|boot|dev|etc|home|lib|lib32|lib64|media|mnt|opt|proc|root|run|sbin|srv|sys|usr|var';

// A command word in command position: start of a line, after ; & | ( `$(`, a quote that opens a
// remote command, or sudo; an optional folder may come before it (/sbin/reboot). The folder part
// stops at the characters that open a new position, and the space part at a newline, so no
// stretch of the command is read from more than one start.
const AT = String.raw`(?:^|[;&|(\n]|\$\(|['"]|\bsudo(?=\s))[^\S\n]*(?:[^\s/;&|('"]*/)*`;
const word = w => new RegExp(`${AT}(?:${w})(?=\\s|$|[;&|)'"])`, 'm');

/** Start positions of every match of a global regex. */
function positions(text, re) {
  return Array.from(text.matchAll(re), m => m.index);
}

/** The first number in a sorted list that is at least `x`, or Infinity. */
function firstAtOrAfter(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length ? sorted[lo] : Infinity;
}

/**
 * `start` (global), then a run of options (`options`, sticky, may be empty), then `tail(text,
 * from, to)` with `from` the end of the start and `to` the end of the options. A start found inside
 * options an earlier hit already read sees the same options and the same tail, so the search goes
 * on after them.
 */
function scan(text, start, options, tail) {
  start.lastIndex = 0;
  while (start.exec(text)) {
    const from = start.lastIndex;
    options.lastIndex = from;
    options.exec(text);
    const to = options.lastIndex;
    if (tail(text, from, to)) return true;
    start.lastIndex = to;
  }
  return false;
}

/** A sticky regex as a tail for scan(): it must match right after the options. */
const tailAt = re => (text, _from, to) => {
  re.lastIndex = to;
  return re.test(text);
};

/**
 * Whether a match of one of `starts` is followed later in the same command (no newline ; & or |
 * in between) by a match of `target`. A start with `run: true` may first swallow the rest of its
 * word, separators included (`sed -i\S*`). One pass per regex and a binary search per start.
 */
function followedInCommand(text, starts, target) {
  const hits = positions(text, target);
  if (!hits.length) return false;
  const seps = positions(text, /[\n;&|]/g);
  const rest = /\S*/y;
  for (const { re, run } of starts) {
    for (const m of text.matchAll(re)) {
      const from = m.index + m[0].length;
      let end = from;
      if (run) {
        rest.lastIndex = from;
        rest.exec(text);
        end = rest.lastIndex;
      }
      if (firstAtOrAfter(hits, from) < firstAtOrAfter(seps, end)) return true;
    }
  }
  return false;
}

const RM_WHOLE = new RegExp(
  String.raw`["']?(?:/|/\*|~(?:/\*?)?|\$HOME(?:/\*?)?|\$\{HOME\}(?:/\*?)?|/(?:${SYSTEM_DIRS})/?\*?)["']?(?=\s|$|[;&|)])`,
  'y'
);
/** rm of / , a system folder or the home folder as its first path (`--` ends the options). */
const rmWhole = text =>
  scan(text, /\brm\s+/g, /(?:(?:-[a-zA-Z]+|--[a-zA-Z-]*)\s+)*/y, tailAt(RM_WHOLE));

/** dd with of=/dev/... later on the same line. */
function ddToDevice(text) {
  for (const line of text.split('\n')) {
    const m = /\bdd\b/.exec(line);
    if (m && /\bof=\/dev\/(?!null\b)/.test(line.slice(m.index + 2))) return true;
  }
  return false;
}

/** chmod/chown/chgrp -R with / or a system folder later in the same command. */
function recursiveModeOnSystem(text) {
  const targets = positions(
    text,
    new RegExp(String.raw`\s["']?/(?:(?:${SYSTEM_DIRS})/?)?["']?(?=\s|$|[;&|)])`, 'g')
  );
  if (!targets.length) return false;
  const start = /\b(?:chmod|chown|chgrp)\s+(?:-(?=[a-zA-Z]*R)[a-zA-Z]+|--recursive)\b/g;
  const segment = /[^\n;&|]*/y;
  return scan(text, start, segment, (t, from, to) => {
    // The space before the path may be the newline that ends the command.
    const at = firstAtOrAfter(targets, from);
    return at < to || (at === to && t[to] === '\n');
  });
}

/** Rules that deny: the machine may not boot or log in again. */
const DENY = [
  [/--no-preserve-root/, 'rm --no-preserve-root'],
  [rmWhole, 'recursive delete of / , a system folder or the home folder'],
  [word('mkfs(?:\\.\\w+)?|wipefs|shred'), 'formatting or wiping a disk'],
  [ddToDevice, 'dd writing to a device'],
  [/>\s*\/dev\/(?:sd|mmcblk|nvme|hd|vd|mtd)/, 'writing straight to a disk device'],
  [recursiveModeOnSystem, 'recursive permission change on / or a system folder'],
  [
    text => scan(text, /\b(?:userdel|deluser)\s+/g, /(?:-\S+\s+)*/y, tailAt(/root\b/y)),
    'removing the root user',
  ],
  [/\bpasswd\s+-[dl]\s+root\b/, 'locking or blanking the root password'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
];

/** dpkg with -r, -P, --remove or --purge among its options. */
const dpkgRemove = text =>
  scan(text, /\bdpkg\s+/g, /(?:-\S+\s+)*/y, (t, from, to) => {
    const remove = /(?:-r|-P|--remove|--purge)\b/y;
    for (let p = from; p <= to; p++) {
      if (p > from && !/\s/.test(t[p - 1])) continue;
      remove.lastIndex = p;
      if (remove.test(t)) return true;
    }
    return false;
  });

/** systemctl stop, disable, mask or restart of an SSH or network service on the same line. */
function stopsRemoteAccess(text) {
  const start = /\bsystemctl[ \t]+/g;
  const options = /(?:-\S+[ \t]+)*/y;
  const verb = /(?:stop|disable|mask|restart)[ \t]+/y;
  const next = /\S+[ \t]+/y;
  const unit =
    /(?:ssh|sshd|dropbear|networking|systemd-networkd|NetworkManager|tailscaled)(?:\.service)?\b/y;
  while (start.exec(text)) {
    options.lastIndex = start.lastIndex;
    options.exec(text);
    let p = options.lastIndex;
    verb.lastIndex = p;
    if (verb.test(text)) {
      for (p = verb.lastIndex; ; p = next.lastIndex) {
        unit.lastIndex = p;
        if (unit.test(text)) return true;
        next.lastIndex = p;
        if (!next.test(text)) break;
      }
    }
    start.lastIndex = Math.max(start.lastIndex, p);
  }
  return false;
}

/** The SSH keys path kept in a variable (keys=/root/.ssh/authorized_keys; mv "$tmp" "$keys"). */
function keysPathInVariable(text) {
  const start = /(?:^|[\s;&|(])\w+=["']?/gm;
  const value = /[^\s"';&|]*/y;
  while (start.exec(text)) {
    const from = start.lastIndex;
    value.lastIndex = from;
    value.exec(text);
    if (text.slice(from, value.lastIndex).includes('authorized_keys')) return true;
    start.lastIndex = value.lastIndex;
  }
  return false;
}

/** Commands that write, copy, move or delete, before a path later in the same command. */
const WRITERS = [
  { re: />/g },
  { re: /\btee\b/g },
  { re: /\btee\b\s+-a/g },
  { re: /\bsed\s+-i/g, run: true },
  { re: /\bcp\b/g },
  { re: /\bmv\b/g },
  { re: /\brm\b/g },
  { re: /\bln\b/g },
  { re: /\btruncate\b/g },
];
const KEY_WRITERS = [
  { re: />/g },
  { re: /\btee\b/g },
  { re: /\bsed\s+-i/g, run: true },
  { re: /\brm\b/g },
  { re: /\bcp\b/g },
  { re: /\bmv\b/g },
];
const CRITICAL_ETC =
  /\/etc\/(?:passwd|shadow|group|gshadow|sudoers|fstab|hosts|hostname|ssh\/|network\/|systemd\/network\/|crypttab|default\/grub)/g;

/** Rules that ask: allowed only with the user's explicit OK, every time. */
const ASK = [
  [
    word(
      'useradd|adduser|userdel|deluser|usermod|groupadd|addgroup|groupdel|delgroup|groupmod|chpasswd|passwd'
    ),
    'users or groups',
  ],
  [
    word('fdisk|sfdisk|cfdisk|gdisk|sgdisk|parted|mkswap|resize2fs|e2fsck|fsck|tune2fs|losetup'),
    'disks or partitions',
  ],
  [
    text =>
      scan(
        text,
        /\b(?:apt|apt-get|aptitude)\s+/g,
        /(?:-\S+\s+)*/y,
        tailAt(/(?:remove|purge|autoremove)\b/y)
      ),
    'removing packages',
  ],
  [dpkgRemove, 'removing packages'],
  [word('reboot|shutdown|poweroff|halt'), 'reboot or shutdown'],
  [
    text =>
      scan(
        text,
        /\bsystemctl\s+/g,
        /(?:-\S+\s+)*/y,
        tailAt(/(?:reboot|poweroff|halt|kexec|rescue|emergency)\b/y)
      ),
    'reboot or shutdown',
  ],
  [word('ufw|iptables|ip6tables|nft|firewall-cmd'), 'firewall'],
  [stopsRemoteAccess, 'SSH or network service'],
  [text => followedInCommand(text, WRITERS, CRITICAL_ETC), 'critical file in /etc'],
  [text => followedInCommand(text, KEY_WRITERS, /authorized_keys/g), 'SSH login keys'],
  [keysPathInVariable, 'SSH login keys (path in a variable)'],
  [/\bdietpi-backup\s+-1\b/, 'restoring a system snapshot'],
  [
    text =>
      followedInCommand(
        text,
        [{ re: /\brm\b/g }, { re: /\bdietpi-backup\b/g }],
        /\/mnt\/dietpi-backup/g
      ),
    'deleting system snapshots',
  ],
  [
    text => followedInCommand(text, [{ re: /\bxargs\b/g }], /\b(?:rm|unlink|shred)\b/g),
    'deleting paths read from input (xargs rm)',
  ],
];

const WHOLE_SYSTEM = new RegExp(String.raw`^/(?:(?:${SYSTEM_DIRS})/?)?\*?$`);
const DELETE_WHOLE = 'recursive delete of / , a system folder or the home folder';
const isOwn = p => OWN_PREFIXES.some(o => p === o.replace(/\/$/, '') || p.startsWith(o));

/** A word without the quotes around it (a loop: `["']+$` re-reads a run of quotes per start). */
function unquote(word) {
  let a = 0;
  let b = word.length;
  while (a < b && (word[a] === '"' || word[a] === "'")) a++;
  while (b > a && (word[b - 1] === '"' || word[b - 1] === "'")) b--;
  return word.slice(a, b);
}

/** 'deny' or 'ask' for a recursive delete of an absolute path, or null below our own folders. */
function absoluteNeed(raw) {
  const p = path.posix.normalize(raw);
  // A wildcard in the first folder (/e*c, /{etc,usr}) may hit a system folder.
  if (WHOLE_SYSTEM.test(raw) || WHOLE_SYSTEM.test(p) || /^\/[^/]*[*?[{]/.test(p)) return 'deny';
  return isOwn(raw) && isOwn(p) ? null : 'ask';
}

/** The same for a path in the home folder (~, ~/x). */
const homeNeed = raw => (/^~\/?\*?$/.test(path.posix.normalize(raw)) ? 'deny' : 'ask');

/** A relative path that means the whole current folder or above it (., .., ../x, *, .*). */
function wholeFolder(raw) {
  const p = path.posix.normalize(raw).replace(/\/+$/, '');
  return p === '.' || p === '..' || p.startsWith('../') || /^[*?.]*\*[*?.]*$/.test(p.split('/')[0]);
}

/**
 * What a recursive delete of a path without `$` needs, as [decision, reason] or null. `cwd` is the
 * folder an earlier `cd` in the same script moved to ('~' or '~/x' in the home folder, null when
 * not known: then only "everything here" paths ask, as the folder may be / or the home folder).
 */
function deleteNeed(target, cwd) {
  if (target.startsWith('/')) {
    const need = absoluteNeed(target);
    return (
      need && [
        need,
        need === 'deny' ? DELETE_WHOLE : `recursive delete outside our own folders (${target})`,
      ]
    );
  }
  if (target === '~' || target.startsWith('~/')) {
    const need = homeNeed(target);
    return [
      need,
      need === 'deny' ? DELETE_WHOLE : `recursive delete in the home folder (${target})`,
    ];
  }
  if (cwd === null) {
    return wholeFolder(target)
      ? ['ask', `recursive delete of the current folder or above it (${target})`]
      : null;
  }
  const full = path.posix.normalize(`${cwd}/${target}`);
  const need = full.startsWith('~')
    ? homeNeed(full)
    : full.startsWith('/')
      ? absoluteNeed(full)
      : 'ask';
  return (
    need && [
      need,
      need === 'deny'
        ? DELETE_WHOLE
        : `recursive delete outside our own folders (${target} in ${cwd})`,
    ]
  );
}

/** The folder `cd <arg>` moves to, from the folder before it (see deleteNeed). */
function cdTarget(arg, cwd) {
  if (arg === undefined) return '~';
  const t = arg.replace(/["']/g, '');
  if (t === '' || t === '-' || /[$`*?[{\\]/.test(t) || /^~[^/]/.test(t)) return null;
  const absolute = t.startsWith('/') || t.startsWith('~');
  if (!absolute && cwd === null) return null;
  const full = path.posix.normalize(absolute ? t : `${cwd}/${t}`);
  return full.startsWith('/') || full === '~' || full.startsWith('~/') ? full : null;
}

const CD =
  /(?:^|[;&|({\n'"]|\$\(|\b(?:then|do|else)(?=\s))[^\S\n]*(?:builtin[^\S\n]+)?(cd|pushd|popd)(?=[\s;&|)'"]|$)/gm;
const CD_OPTIONS = /(?:[^\S\n]+-[LPe@]+(?=\s|$))*/y;
const CD_ARG = /[^\S\n]+((?:"[^"\n]*"|'[^'\n]*'|[^\s;&|)'"])+)/y;
const RM = /\brm\s+((?:-[a-zA-Z-]+\s+)*)([^\n;&|)]*)/g;
const FIND = /\bfind(?=\s)/g;
const FIND_OPTIONS = /(?:[^\S\n]+(?:-[HLP]+|-O\d*|-D[^\S\n]+\S+)(?=\s|$))*/y;
const FIND_PATH = /[^\S\n]+(?![-!(),])((?:"[^"\n]*"|'[^'\n]*'|\\.|[^\s;&|()'"\\])+)/y;

/**
 * Recursive deletes outside our own folders (or of an unguarded variable), `find` deleting what it
 * finds, and deletes of relative paths after a `cd` (cd / && rm -rf *). `starts` are the offsets
 * where a new script begins in `text`: the folder is not known again there.
 */
function deletes(text, starts) {
  const events = [];
  for (const m of text.matchAll(CD)) {
    const at = m.index + m[0].length;
    let arg;
    if (m[1] !== 'popd') {
      CD_OPTIONS.lastIndex = at;
      CD_OPTIONS.exec(text);
      CD_ARG.lastIndex = CD_OPTIONS.lastIndex;
      const a = CD_ARG.exec(text);
      if (a) arg = a[1];
    }
    // At the word itself: the match may begin with the newline that ends the script before.
    events.push({ at: at - m[1].length, cd: arg, reset: m[1] === 'popd' });
  }
  // The remote side of ssh starts in its own folder: a local `cd` before it does not count.
  for (const m of text.matchAll(/(?:^|[\s;&|(])(?:ssh|plink)(?:\.exe)?(?=\s|$)/g)) {
    events.push({ at: m.index, cd: null, reset: true });
  }
  for (const m of text.matchAll(RM)) {
    if (!/(?:^|\s)-(?:[a-zA-Z]*[rR][a-zA-Z]*|-recursive)\b/.test(` ${m[1] ?? ''}`)) continue;
    events.push({ at: m.index, rm: (m[2] ?? '').trim().split(/\s+/) });
  }
  findDeletes(text, events);
  events.sort((a, b) => a.at - b.at);

  const ask = [];
  const deny = [];
  let cwd = null;
  let next = 0;
  for (const e of events) {
    while (next < starts.length && starts[next] <= e.at) {
      cwd = null;
      next++;
    }
    if ('cd' in e) {
      cwd = e.reset ? null : cdTarget(e.cd, cwd);
      continue;
    }
    for (const raw of e.rm ?? e.find) {
      const target = unquote(raw);
      if (!target || (e.rm && target.startsWith('-'))) continue;
      if (target.includes('$')) {
        // ${VAR:?} fails when VAR is empty; $tmp is our own mktemp folder.
        if (/\$\{\w+:\?\}/.test(target) || /^\$\{?tmp\}?(?:["']?\/|$)/.test(target)) continue;
        if (e.rm) {
          ask.push(`recursive delete of a variable path without a guard (${target})`);
        } else {
          // find "$stage/dist" -delete: an empty variable leaves /dist, which is harmless; a bare
          // variable or one before a system folder leaves / or that folder.
          const bare = target.replace(/\$\{[^}]*\}|\$\w+|\$./g, '') || '/';
          const first = bare.split('/').filter(Boolean)[0];
          if (!first || new RegExp(`^(?:${SYSTEM_DIRS})$`).test(first)) {
            ask.push(`find deleting below a variable path without a guard (${target})`);
          }
        }
        continue;
      }
      const need = deleteNeed(target, cwd);
      if (need)
        (need[0] === 'deny' ? deny : ask).push(e.find ? `find -delete: ${need[1]}` : need[1]);
    }
  }
  return { ask, deny };
}

/** `find <paths> ... -delete` (or -exec rm) events, pushed to `events` with their start paths. */
function findDeletes(text, events) {
  const seps = positions(text, /[\n&|]|(?<!\\);/g);
  const dels = positions(text, /(?<=^|[\s'"])-delete(?=\s|$|[;&|)'"])/g);
  const execs = positions(text, /(?<=^|[\s'"])-(?:exec|execdir|ok|okdir)(?=[\s'"])/g);
  const removers = positions(text, /\b(?:rm|unlink|shred)\b/g);
  FIND.lastIndex = 0;
  for (let m; (m = FIND.exec(text)); ) {
    FIND_OPTIONS.lastIndex = FIND.lastIndex;
    FIND_OPTIONS.exec(text);
    let end = FIND_OPTIONS.lastIndex;
    const paths = [];
    for (;;) {
      FIND_PATH.lastIndex = end;
      const p = FIND_PATH.exec(text);
      if (!p) break;
      paths.push(p[1]);
      end = FIND_PATH.lastIndex;
    }
    // A `find` among the paths is a path, not a command: go on after them.
    FIND.lastIndex = end;
    const stop = firstAtOrAfter(seps, end);
    const exec = firstAtOrAfter(execs, end);
    if (
      firstAtOrAfter(dels, end) < stop ||
      (exec < stop && firstAtOrAfter(removers, exec) < stop)
    ) {
      events.push({ at: m.index, find: paths.length ? paths : ['.'] });
    }
  }
}

/**
 * The words of each `cat a b |` (quoted words may hold ; & or |, so `cat "a;b.txt" |` is still
 * read). From one point the scan is fixed: plain characters, quoted strings, and a stop at the
 * first | ; & < > or unclosed quote. Tables of the next special character and the next quote of
 * each kind give every `cat` its stop in one step, where the old single regex re-read the rest
 * of the command from every `cat` without a pipe after it.
 */
function catPipeWords(command) {
  const n = command.length;
  const nextSpecial = new Int32Array(n + 1).fill(n);
  const nextDq = new Int32Array(n + 2).fill(-1);
  const nextSq = new Int32Array(n + 2).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    const c = command[i];
    nextSpecial[i] = '|;&<>"\''.includes(c) ? i : nextSpecial[i + 1];
    nextDq[i] = c === '"' ? i : nextDq[i + 1];
    nextSq[i] = c === "'" ? i : nextSq[i + 1];
  }
  // stopAt[i] for a special character at i: where the scan that reaches i stops.
  const stopAt = new Int32Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) {
    const c = command[i];
    if (c !== '"' && c !== "'") {
      stopAt[i] = i;
      continue;
    }
    const close = (c === '"' ? nextDq : nextSq)[i + 1];
    stopAt[i] = close < 0 ? i : stopAt[nextSpecial[close + 1]];
  }
  const out = [];
  const start = /\bcat\s/g;
  for (let m; (m = start.exec(command)); ) {
    const from = m.index + m[0].length;
    const stop = stopAt[nextSpecial[from]];
    if (command[stop] !== '|') {
      start.lastIndex = m.index + 1;
      continue;
    }
    for (const t of command.slice(from, stop).matchAll(/"[^"]+"|'[^']+'|[^\s]+/g)) out.push(t[0]);
    start.lastIndex = stop + 1;
  }
  return out;
}

/** Names ending in .sh, quoted or not (what /("…\.sh"|'…\.sh'|[^\s'"|;&<>]+\.sh)\b/g found). */
function shNames(command) {
  const out = [];
  const plain = c => c !== undefined && !/[\s'"|;&<>]/.test(c);
  const wordChar = c => c !== undefined && /\w/.test(c);
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (c === '"' || c === "'") {
      const close = command.indexOf(c, i + 1);
      const inside = close < 0 ? '' : command.slice(i + 1, close);
      if (inside.length >= 4 && inside.endsWith('.sh') && wordChar(command[close + 1])) {
        out.push(command.slice(i, close + 1));
        i = close + 1;
      } else {
        i++;
      }
      continue;
    }
    if (!plain(c)) {
      i++;
      continue;
    }
    // A plain run: the name runs from its start to the last `.sh` with a word end after it.
    let end = i;
    let last = -1;
    while (plain(command[end])) {
      if (end >= i + 1 && command.startsWith('.sh', end) && !wordChar(command[end + 3])) last = end;
      end++;
    }
    if (last >= 0 && last + 3 <= end) out.push(command.slice(i, last + 3));
    i = end;
  }
  return out;
}

/** Local script files the command feeds to the remote side. */
function fedFiles(command, cwd) {
  const names = new Set();
  for (const m of command.matchAll(/<\s*("[^"]+"|'[^']+'|\S+)/g)) names.add(m[1]);
  for (const t of catPipeWords(command)) names.add(t);
  for (const t of shNames(command)) names.add(t);
  const texts = [];
  for (const name of names) {
    const clean = name.replace(/^["']|["']$/g, '');
    const full = path.isAbsolute(clean) ? clean : path.join(cwd, clean);
    try {
      if (existsSync(full) && statSync(full).isFile() && statSync(full).size < 2_000_000) {
        texts.push(readFileSync(full, 'utf8'));
      }
    } catch {
      // unreadable: the command text is still checked
    }
  }
  return texts;
}

/** ssh options that take an argument (the next word is not the host). */
const SSH_ARG_OPTS = new Set(
  '-B -b -c -D -E -e -F -I -i -J -L -l -m -O -o -p -Q -R -S -W -w'.split(' ')
);

/**
 * The remote command of `ssh [options] host command...` written without quotes, put on a line of
 * its own so the command-position rules see it (`ssh foundry-pi reboot`).
 */
function unquotedRemoteCommands(command) {
  const out = [];
  for (const line of command.split('\n')) {
    const words = line.trim().split(/\s+/);
    const at = words.findIndex(w => /(^|[\\/])ssh(\.exe)?$/.test(w));
    if (at < 0) continue;
    let i = at + 1;
    while (i < words.length && words[i].startsWith('-')) i += SSH_ARG_OPTS.has(words[i]) ? 2 : 1;
    const rest = words.slice(i + 1).join(' ');
    if (rest) out.push(rest.replace(/^['"]/, ''));
  }
  return out;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * The hosts a command reaches with ssh, scp, sftp, rsync or plink, or null when one cannot be told
 * (a jump host, a proxy or a HostName override counts as "cannot tell": it may lead to another
 * machine). Used only to let commands through whose every target is this machine, which in
 * practice means a test container (the user's pick, 2026-10-05); the Pi is never reached as
 * localhost.
 */
function remoteHosts(command) {
  if (/(?:^|\s)-J\S*|\bProxy(?:Jump|Command)\b|\bHostName\b/i.test(command)) return null;
  const hosts = [];
  for (const line of command.split('\n')) {
    const words = line.trim().split(/\s+/);
    const tools = words.map(
      w => w.match(/(?:^|[\\/;&|(])(ssh|scp|sftp|rsync|plink)(?:\.exe)?$/)?.[1]
    );
    // hostAt[i]: the first word from i on that is not an option (or one of its arguments).
    const hostAt = new Int32Array(words.length + 2).fill(words.length);
    for (let i = words.length - 1; i >= 0; i--) {
      const step = SSH_ARG_OPTS.has(words[i]) || words[i] === '-P' ? 2 : 1;
      hostAt[i] = words[i].startsWith('-') ? hostAt[Math.min(i + step, words.length)] : i;
    }
    for (let at = 0; at < words.length; at++) {
      const tool = tools[at];
      if (!tool) continue;
      if (tool === 'scp' || tool === 'rsync') {
        // Targets are the arguments with host:path; stop at the next command separator, or after
        // the next scp or rsync, which reads the same words on from there.
        for (let i = at + 1; i < words.length && !/^[;&|]/.test(words[i]); i++) {
          const m = words[i].match(/^["']?(?:[^@\s:"']+@)?(\[[^\]]+\]|[^:\s/"'@]+):/);
          if (m) hosts.push(m[1]);
          if (tools[i] === 'scp' || tools[i] === 'rsync') break;
        }
        continue;
      }
      const i = hostAt[at + 1];
      if (i >= words.length) return null;
      hosts.push(words[i].replace(/^["']|["']$/g, '').replace(/^[^@]+@/, ''));
    }
  }
  return hosts.length ? hosts : null;
}

/** Drop comment lines: a rule named in a comment is not a command. */
const notComment = line => !/^\s*#/.test(line);

const hit = (rule, text) => (typeof rule === 'function' ? rule(text) : rule.test(text));

export function decide(command, cwd = process.cwd()) {
  if (!REMOTE.test(command)) return null;
  const hosts = remoteHosts(command);
  if (hosts && hosts.every(h => LOCAL_HOSTS.has(h.toLowerCase()))) return null;
  // The command, its unquoted remote part and each fed file, without comment lines; `starts` are
  // the offsets where each one begins in the joined text.
  const parts = [command, ...unquotedRemoteCommands(command), ...fedFiles(command, cwd)]
    .map(p => p.split('\n').filter(notComment))
    .filter(lines => lines.length)
    .map(lines => lines.join('\n'));
  const starts = [];
  let offset = 0;
  for (const p of parts) {
    starts.push(offset);
    offset += p.length + 1;
  }
  const text = parts.join('\n');
  const removal = deletes(text, starts);
  const deny = [...DENY.filter(([rule]) => hit(rule, text)).map(([, why]) => why), ...removal.deny];
  if (deny.length) return { decision: 'deny', reasons: [...new Set(deny)] };
  const ask = [...ASK.filter(([rule]) => hit(rule, text)).map(([, why]) => why), ...removal.ask];
  if (ask.length) return { decision: 'ask', reasons: [...new Set(ask)] };
  return null;
}

/**
 * Permission modes in which Claude Code shows an "ask" to the user. In the others (bypass
 * permissions, auto, don't ask, or no mode given) an "ask" would be answered without the user
 * (seen live on 2026-10-04 in bypass mode), so it becomes a "deny".
 */
const MODES_THAT_ASK = new Set(['default', 'acceptEdits', 'plan']);

export function finalDecision(decision, mode) {
  if (decision === 'ask' && !MODES_THAT_ASK.has(mode ?? '')) return 'deny';
  return decision;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (raw += chunk));
  process.stdin.on('end', () => {
    let command = '';
    let cwd = process.cwd();
    let mode;
    try {
      const payload = JSON.parse(raw);
      command = String(payload?.tool_input?.command ?? '');
      if (typeof payload?.cwd === 'string') cwd = payload.cwd;
      if (typeof payload?.permission_mode === 'string') mode = payload.permission_mode;
    } catch {
      return; // not a payload we understand: allow
    }
    const result = decide(command, cwd);
    if (!result) return;
    const decision = finalDecision(result.decision, mode);
    const list = result.reasons.join('; ');
    const reason =
      result.decision === 'deny'
        ? `Blocked by .claude/hooks/guard-remote-commands.mjs (the Pi safety rule): ${list}. This can make the machine unusable; the user runs it by hand if it is really needed.`
        : decision === 'deny'
          ? `Blocked by .claude/hooks/guard-remote-commands.mjs: the Pi safety rule needs the user's explicit OK for: ${list}. This session runs in "${mode ?? 'an unknown'}" permission mode, where an approval prompt would be answered without the user. Ask the user in chat; to approve, the user switches this session to the default permission mode and confirms the prompt.`
          : `The Pi safety rule (CLAUDE.md) needs the user's explicit OK for: ${list}. Confirm only if you asked for exactly this.`;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: reason,
        },
      })
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
