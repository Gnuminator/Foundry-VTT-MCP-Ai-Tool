#!/usr/bin/env node
// Voice memos into prep (idea 3.9): turn the memos inbox into notes in the GM vault.
//
//   node scripts/voice-memos.mjs [--memos-dir <dir>] [--vault <dir>]
//
// The inbox is filled by the Discord bot (a voice message in a DM) or by dropping an audio file in
// `<memos dir>/inbox`. Speech to text is the local transcriber (scripts/voice-stack.ps1 transcribe,
// GPU lock included); nothing is sent anywhere. Notes land in `Prep/Voice memos` of the campaign.
//
// Memos dir: --memos-dir, else FVTT_MEMOS_DIR, else FoundryMemos in FVTT_DATA_DIR, else Documents.
// Vault: --vault, else FOUNDRY_AI_OBSIDIAN_DIR. World: --world <id>, else the only folder under
// Campaigns (notes go in <vault>/Campaigns/<world>/Prep/Voice memos).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processInbox, resolveCampaignDir, transcriptText } from './voice-memos-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export function defaultMemosDir(env = process.env, home = homedir()) {
  if (env.FVTT_MEMOS_DIR) return env.FVTT_MEMOS_DIR;
  const legacy = join(home, 'Documents', 'FoundryMemos');
  if (!env.FVTT_DATA_DIR) return legacy;
  const moved = join(env.FVTT_DATA_DIR, 'FoundryMemos');
  return existsSync(moved) || !existsSync(legacy) ? moved : legacy;
}

/** Run the local transcriber on a folder of memoN audio files; returns `{ memoN: text }`. */
export function transcribeWithVoiceStack(dir) {
  const hotwords = existsSync(join(dir, 'names.txt')) ? ['-Hotwords'] : [];
  const r = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-File',
      join(here, 'voice-stack.ps1'),
      'transcribe',
      dir,
      '-NoPipeline',
      ...hotwords,
    ],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) throw new Error(`the transcriber stopped with exit code ${r.status}`);
  const jsonDir = join(dir, 'transcripts', 'json');
  if (!existsSync(jsonDir)) throw new Error(`the transcriber wrote no JSON in ${jsonDir}`);
  const out = {};
  for (const f of readdirSync(jsonDir).filter(n => n.endsWith('.json'))) {
    out[f.replace(/\.json$/, '')] = transcriptText(
      JSON.parse(readFileSync(join(jsonDir, f), 'utf8'))
    );
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const memosDir = argValue(args, '--memos-dir') ?? defaultMemosDir();
  const vaultRoot = argValue(args, '--vault') ?? process.env.FOUNDRY_AI_OBSIDIAN_DIR?.trim();
  if (!vaultRoot) {
    console.error('voice-memos: no GM vault. Pass --vault or set FOUNDRY_AI_OBSIDIAN_DIR.');
    process.exit(2);
  }
  const vaultDir = resolveCampaignDir(vaultRoot, argValue(args, '--world'));
  const results = await processInbox({ memosDir, vaultDir, transcribe: transcribeWithVoiceStack });
  if (results.length === 0) console.log(`voice-memos: no memos in ${join(memosDir, 'inbox')}`);
  for (const r of results) {
    console.log(
      r.ok
        ? `voice-memos: ${r.file} -> ${r.note}${r.tags.length ? ` (tags: ${r.tags.join(', ')})` : ''}`
        : `voice-memos: ${r.file} FAILED, left in the inbox: ${r.error}`
    );
  }
  if (results.some(r => !r.ok)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error(`voice-memos: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
