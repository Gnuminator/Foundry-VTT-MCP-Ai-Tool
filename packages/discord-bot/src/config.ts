/**
 * Settings come from `%APPDATA%\foundry-ai-tool\discord-bot.env` (the token never lives in the
 * repo or in chat), overridden by real environment variables of the same name.
 *
 * | Key                  | Meaning                                                     |
 * | -------------------- | ----------------------------------------------------------- |
 * | `DISCORD_TOKEN`      | the bot token (required to run the bot)                     |
 * | `DISCORD_GUILD_ID`   | register the slash commands in this server only (instant)   |
 * | `FVTT_SESSIONS_DIR`  | where recordings go; default `Documents\FoundrySessions`    |
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BotConfig {
  token: string;
  guildId: string | undefined;
  sessionsDir: string;
  envFile: string;
}

export function defaultEnvFile(): string {
  const appData = process.env['APPDATA'] ?? join(homedir(), '.config');
  return join(appData, 'foundry-ai-tool', 'discord-bot.env');
}

/** Parse `KEY=value` lines; `#` comments and blank lines are skipped, quotes are stripped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function loadConfig(envFile = defaultEnvFile(), requireToken = true): BotConfig {
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  // An empty environment variable does not hide the value in the file.
  const get = (key: string): string | undefined => {
    for (const value of [process.env[key], fromFile[key]]) if (value) return value;
    return undefined;
  };
  const token = get('DISCORD_TOKEN') ?? '';
  if (requireToken && !token) {
    throw new Error(`DISCORD_TOKEN is not set. Put it in ${envFile} as DISCORD_TOKEN=...`);
  }
  return {
    token,
    guildId: get('DISCORD_GUILD_ID'),
    sessionsDir: get('FVTT_SESSIONS_DIR') ?? join(homedir(), 'Documents', 'FoundrySessions'),
    envFile,
  };
}
