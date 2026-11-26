/**
 * The whisper desk: the GM writes one line to one player and it goes out two ways at once, as a
 * Foundry whisper (only that player and the GMs see it) and, when the player has a Discord link,
 * as a private message through the omens outbox. Every whisper lands in the secret ledger, so the
 * GM, the session notes and Claude know afterwards who was told what.
 *
 * Order matters: Foundry first. If the whisper cannot reach the player there (no such user, a
 * write switch off) nothing else is recorded, so the ledger never claims a whisper that did not go
 * out. The Discord step and the ledger step then cannot undo the Foundry one; their outcome is
 * reported back so the GM sees what did not happen.
 */
import type { OmensStore } from '../omens/store.js';

import type { LedgerStore, LedgerView } from './store.js';

interface WhisperDeskOptions {
  /** Sends the Foundry whisper; throws when it did not reach the named player. */
  sendFoundryWhisper: (playerName: string, text: string) => Promise<void>;
  omens: Pick<OmensStore, 'addWhisper'>;
  ledger: Pick<LedgerStore, 'add'>;
}

interface WhisperResult {
  /** The Foundry whisper went to this player. */
  foundry: true;
  /** `queued`: the Discord bot sends it at its next check; `no-link`: this player has no Discord link; `failed`: could not queue. */
  discord: 'queued' | 'no-link' | 'failed';
  /** The ledger entry, or null when it could not be written (the whisper still went out). */
  entry: LedgerView | null;
  warnings: string[];
}

export class WhisperDesk {
  constructor(private readonly options: WhisperDeskOptions) {}

  async send(userId: unknown, name: unknown, text: unknown): Promise<WhisperResult> {
    if (typeof userId !== 'string' || !/^[A-Za-z0-9]{16}$/.test(userId)) {
      throw new Error('Pick a player to whisper to.');
    }
    if (typeof name !== 'string' || !name.trim()) throw new Error('The player needs a name.');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Write the whisper first.');
    const line = text.trim();
    const player = name.trim();
    const warnings: string[] = [];

    await this.options.sendFoundryWhisper(player, line);

    let discord: WhisperResult['discord'] = 'failed';
    try {
      const queued = await this.options.omens.addWhisper(userId, line);
      discord = queued ? 'queued' : 'no-link';
    } catch (err) {
      warnings.push(`Not queued on Discord: ${(err as Error).message}`);
    }

    let entry: LedgerView | null = null;
    try {
      entry = await this.options.ledger.add({
        kind: 'whisper',
        text: line,
        knownBy: [{ userId, name: player }],
        source: 'whisper-desk',
      });
    } catch (err) {
      warnings.push(`Not written to the ledger: ${(err as Error).message}`);
    }
    return { foundry: true, discord, entry, warnings };
  }
}

/** The `whisper` control method (dashboard only; not a tool, never listed to Claude). */
export async function whisperControlReply(
  desk: WhisperDesk,
  id: unknown,
  params: unknown
): Promise<{ id: unknown; result: unknown } | { id: unknown; error: { message: string } }> {
  try {
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
    return { id, result: await desk.send(p.userId, p.name, p.text) };
  } catch (e: unknown) {
    return { id, error: { message: e instanceof Error ? e.message : 'Bad request' } };
  }
}
