// Live Claude Code sessions from ~/.claude/sessions/<pid>.json. Never touches the .key files.
import fs from 'node:fs';
import path from 'node:path';

export function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function s(v, max = 300) {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

export function readLiveSessions({ sessionsDir, isAlive = defaultIsAlive }) {
  const sessions = [];
  let formatChanged = false;
  let names = [];
  try {
    names = fs.readdirSync(sessionsDir).filter(n => n.endsWith('.json'));
  } catch {
    return { sessions, formatChanged };
  }
  for (const name of names) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8'));
    } catch {
      formatChanged = true;
      continue;
    }
    if (!raw || typeof raw !== 'object' || !raw.sessionId || raw.pid == null || !raw.status) {
      formatChanged = true;
      continue;
    }
    const pid = Number(raw.pid);
    sessions.push({
      pid: Number.isFinite(pid) ? pid : null,
      sessionId: s(raw.sessionId, 100),
      cwd: s(raw.cwd),
      name: s(raw.name, 300),
      status: s(raw.status, 40),
      updatedAt:
        typeof raw.updatedAt === 'number' || typeof raw.updatedAt === 'string'
          ? raw.updatedAt
          : null,
      hostSessionId: s(raw.hostSessionId, 100),
      startedAt:
        typeof raw.startedAt === 'number' || typeof raw.startedAt === 'string'
          ? raw.startedAt
          : null,
      alive: Number.isFinite(pid) ? Boolean(isAlive(pid)) : false,
    });
  }
  return { sessions, formatChanged };
}
