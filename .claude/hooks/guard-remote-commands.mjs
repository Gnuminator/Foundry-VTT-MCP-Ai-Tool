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
//     recursive deletes outside our own folders).
// It cannot be talked out of a decision: it is code, not judgement. A false alarm only costs a
// confirmation click.
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

// A command word in command position: start, after ; & | ( newline, `$(`, a quote that opens a
// remote command, or sudo.
const AT = String.raw`(?:^|[;&|(\n]|\$\(|['"]|\bsudo\s+)\s*`;
const word = w => new RegExp(`${AT}(?:\\S*/)?(?:${w})(?=\\s|$|[;&|)'"])`, 'm');

/** Rules that deny: the machine may not boot or log in again. */
const DENY = [
  [/--no-preserve-root/, 'rm --no-preserve-root'],
  [
    new RegExp(
      String.raw`\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+|-[a-zA-Z]+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+)?["']?(?:/|/\*|~/?|\$HOME/?|/(?:${SYSTEM_DIRS})/?\*?)["']?(?=\s|$|[;&|)])`
    ),
    'recursive delete of / , a system folder or the home folder',
  ],
  [word('mkfs(?:\\.\\w+)?|wipefs|shred'), 'formatting or wiping a disk'],
  [/\bdd\b[^\n]*\bof=\/dev\/(?!null\b)/, 'dd writing to a device'],
  [/>\s*\/dev\/(?:sd|mmcblk|nvme|hd|vd|mtd)/, 'writing straight to a disk device'],
  [
    new RegExp(
      String.raw`\b(?:chmod|chown|chgrp)\s+(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)\b[^\n;&|]*\s["']?/(?:(?:${SYSTEM_DIRS})/?)?["']?(?=\s|$|[;&|)])`
    ),
    'recursive permission change on / or a system folder',
  ],
  [/\b(?:userdel|deluser)\s+(?:-\S+\s+)*root\b/, 'removing the root user'],
  [/\bpasswd\s+-[dl]\s+root\b/, 'locking or blanking the root password'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
];

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
  [/\b(?:apt|apt-get|aptitude)\s+(?:-\S+\s+)*(?:remove|purge|autoremove)\b/, 'removing packages'],
  [/\bdpkg\s+(?:-\S+\s+)*(?:-r|-P|--remove|--purge)\b/, 'removing packages'],
  [word('reboot|shutdown|poweroff|halt'), 'reboot or shutdown'],
  [
    /\bsystemctl\s+(?:-\S+\s+)*(?:reboot|poweroff|halt|kexec|rescue|emergency)\b/,
    'reboot or shutdown',
  ],
  [word('ufw|iptables|ip6tables|nft|firewall-cmd'), 'firewall'],
  [
    /\bsystemctl[ \t]+(?:-\S+[ \t]+)*(?:stop|disable|mask|restart)[ \t]+(?:\S+[ \t]+)*(?:ssh|sshd|dropbear|networking|systemd-networkd|NetworkManager|tailscaled)(?:\.service)?\b/,
    'SSH or network service',
  ],
  [
    /(?:>|\btee\b(?:\s+-a)?|\bsed\s+-i\S*|\bcp\b|\bmv\b|\brm\b|\bln\b|\btruncate\b)[^\n;&|]*\/etc\/(?:passwd|shadow|group|gshadow|sudoers|fstab|hosts|hostname|ssh\/|network\/|systemd\/network\/|crypttab|default\/grub)/,
    'critical file in /etc',
  ],
  [/(?:>|\btee\b|\bsed\s+-i\S*|\brm\b|\bcp\b|\bmv\b)[^\n;&|]*authorized_keys/, 'SSH login keys'],
  // The same path kept in a variable (keys=/root/.ssh/authorized_keys; mv "$tmp" "$keys").
  [/(?:^|[\s;&|(])\w+=["']?[^\s"';&|]*authorized_keys/m, 'SSH login keys (path in a variable)'],
  [/\bdietpi-backup\s+-1\b/, 'restoring a system snapshot'],
  [
    /(?:\brm\b[^\n;&|]*|\bdietpi-backup\b[^\n;&|]*)\/mnt\/dietpi-backup/,
    'deleting system snapshots',
  ],
];

/** Recursive deletes outside our own folders (or of an unguarded variable) also ask. */
function recursiveDeleteOutsideOwn(text) {
  const reasons = [];
  const rm = /\brm\s+((?:-[a-zA-Z-]+\s+)*)([^\n;&|)]*)/g;
  for (const match of text.matchAll(rm)) {
    const flags = match[1] ?? '';
    if (!/(?:^|\s)-(?:[a-zA-Z]*[rR][a-zA-Z]*|-recursive)\b/.test(` ${flags}`)) continue;
    for (const raw of (match[2] ?? '').trim().split(/\s+/)) {
      const target = raw.replace(/^["']+|["']+$/g, '');
      if (!target || target.startsWith('-')) continue;
      if (target.includes('$')) {
        // ${VAR:?} fails when VAR is empty; $tmp is our own mktemp folder.
        if (/\$\{\w+:\?\}/.test(target) || /^\$\{?tmp\}?(?:["']?\/|$)/.test(target)) continue;
        reasons.push(`recursive delete of a variable path without a guard (${target})`);
        continue;
      }
      if (!target.startsWith('/')) continue; // relative: below the current folder
      if (OWN_PREFIXES.some(p => target === p.replace(/\/$/, '') || target.startsWith(p))) continue;
      reasons.push(`recursive delete outside our own folders (${target})`);
    }
  }
  return reasons;
}

/** Local script files the command feeds to the remote side. */
function fedFiles(command, cwd) {
  const names = new Set();
  for (const m of command.matchAll(/<\s*("[^"]+"|'[^']+'|\S+)/g)) names.add(m[1]);
  for (const m of command.matchAll(/\bcat\s+((?:("[^"]+"|'[^']+'|[^\s|;&<>]+)\s*)+)\|/g)) {
    for (const t of m[1].matchAll(/"[^"]+"|'[^']+'|[^\s]+/g)) names.add(t[0]);
  }
  for (const m of command.matchAll(/("[^"]+\.sh"|'[^']+\.sh'|[^\s'"|;&<>]+\.sh)\b/g))
    names.add(m[1]);
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
    for (let at = 0; at < words.length; at++) {
      const tool = words[at].match(/(?:^|[\\/;&|(])(ssh|scp|sftp|rsync|plink)(?:\.exe)?$/)?.[1];
      if (!tool) continue;
      if (tool === 'scp' || tool === 'rsync') {
        // Targets are the arguments with host:path; stop at the next command separator.
        for (let i = at + 1; i < words.length && !/^[;&|]/.test(words[i]); i++) {
          const m = words[i].match(/^["']?(?:[^@\s:"']+@)?(\[[^\]]+\]|[^:\s/"'@]+):/);
          if (m) hosts.push(m[1]);
        }
        continue;
      }
      let i = at + 1;
      while (i < words.length && words[i].startsWith('-')) {
        i += SSH_ARG_OPTS.has(words[i]) || words[i] === '-P' ? 2 : 1;
      }
      if (i >= words.length) return null;
      hosts.push(words[i].replace(/^["']|["']$/g, '').replace(/^[^@]+@/, ''));
    }
  }
  return hosts.length ? hosts : null;
}

/** Drop comment lines: a rule named in a comment is not a command. */
function withoutComments(text) {
  return text
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');
}

export function decide(command, cwd = process.cwd()) {
  if (!REMOTE.test(command)) return null;
  const hosts = remoteHosts(command);
  if (hosts && hosts.every(h => LOCAL_HOSTS.has(h.toLowerCase()))) return null;
  const text = withoutComments(
    [command, ...unquotedRemoteCommands(command), ...fedFiles(command, cwd)].join('\n')
  );
  const deny = DENY.filter(([re]) => re.test(text)).map(([, why]) => why);
  if (deny.length) return { decision: 'deny', reasons: [...new Set(deny)] };
  const ask = [
    ...ASK.filter(([re]) => re.test(text)).map(([, why]) => why),
    ...recursiveDeleteOutsideOwn(text),
  ];
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
