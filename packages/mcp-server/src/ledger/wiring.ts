/**
 * The GM-private stores the dashboard reaches through control methods (not tools): omens, the
 * secret ledger and the whisper desk. Built together because the whisper desk writes to both.
 * `control` answers the `omens`, `ledger` and `whisper` control methods.
 */
import { DIRECT_WRITE_TIMEOUT_MS, queryTimeoutContext } from '../direct-write-timeout.js';
import type { FoundryClient } from '../foundry-client.js';
import { createOmensStore, omensControlReply } from '../omens/store.js';
import type { SecretTermsService } from '../secret-terms.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import { LedgerStore, handleLedgerControl } from './store.js';
import { WhisperDesk, whisperControlReply } from './whisper-desk.js';

type ControlReply = { id: unknown; result: unknown } | { id: unknown; error: { message: string } };

export function createGmPrivate(
  store: VaultStore,
  worldIds: Pick<WorldIdResolver, 'current'>,
  secretTerms: Pick<SecretTermsService, 'findSecretTerms'>,
  foundryClient: Pick<FoundryClient, 'query'>
): {
  stores: { omens: ReturnType<typeof createOmensStore>; ledger: LedgerStore };
  control: (method: string, id: unknown, params: unknown) => Promise<ControlReply>;
} {
  const omens = createOmensStore(store, worldIds, secretTerms);
  const ledger = new LedgerStore({ store, worldIds });
  const desk = new WhisperDesk({
    omens,
    ledger,
    sendFoundryWhisper: async (playerName, text): Promise<void> => {
      const reply = (await queryTimeoutContext.run({ timeoutMs: DIRECT_WRITE_TIMEOUT_MS }, () =>
        foundryClient.query('foundry-mcp-bridge.sendChatMessage', {
          message: text,
          messageType: 'whisper',
          whisperTargets: [playerName],
        })
      )) as { success?: boolean; error?: string; warning?: string } | undefined;
      if (reply?.success === false) throw new Error(reply.error || 'Failed to send the whisper');
      // A name that matches no Foundry user whispers to the GMs only: not delivered.
      if (reply?.warning) throw new Error(`Not delivered: ${reply.warning}`);
    },
  });
  return {
    stores: { omens, ledger },
    control: async (method, id, params): Promise<ControlReply> => {
      if (method === 'whisper') return whisperControlReply(desk, id, params);
      if (method === 'omens') return omensControlReply(omens, id, params);
      try {
        return { id, result: await handleLedgerControl(ledger, params) };
      } catch (e: unknown) {
        return { id, error: { message: e instanceof Error ? e.message : 'Bad request' } };
      }
    },
  };
}
