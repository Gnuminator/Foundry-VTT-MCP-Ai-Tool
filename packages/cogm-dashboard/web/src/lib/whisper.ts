// The whisper desk's words (components/WhisperDesk.tsx): what the GM is told after a send.

/** The longest whisper the bridge takes. */
export const WHISPER_MAX = 600;

/** What POST /api/whisper answers. */
export interface WhisperAnswer {
  foundry?: boolean;
  discord?: 'queued' | 'no-link' | 'failed';
  warnings?: string[];
}

/** The toast after a whisper: where it went, and what did not happen. */
export function whisperDone(name: string, answer: WhisperAnswer): { ok: boolean; text: string } {
  const parts = [`✓ Whispered to ${name} in Foundry`];
  if (answer.discord === 'queued') parts.push('Discord message goes out within a few minutes');
  else if (answer.discord === 'no-link') parts.push(`${name} has no Discord link, so no message`);
  else parts.push('the Discord message was not queued');
  const warnings = answer.warnings ?? [];
  if (answer.discord === 'failed' || warnings.length > 0) {
    return { ok: false, text: `${[...parts, ...warnings].join('. ')}.` };
  }
  return { ok: true, text: `${parts.join('. ')}.` };
}
