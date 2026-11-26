// Who knows what (secret ledger), the dashboard's side: the GM-only list from /api/ledger and the
// chip words. The text of an entry is private; it is shown only on GM screens and never sent to
// the player page or the TV. The chip line is made by the bridge (ledger/store.ts knownByLine).
import { api } from './api';

export interface LedgerKnower {
  userId: string;
  name: string;
}

export interface LedgerEntry {
  id: string;
  kind: 'secret' | 'backstory' | 'whisper';
  text: string;
  knownBy: LedgerKnower[];
  pageId?: string;
  pageName?: string;
  source: 'gm' | 'whisper-desk';
  at: string;
}

interface LedgerChip {
  line: string;
  knownBy: LedgerKnower[];
}

interface LedgerData {
  entries: LedgerEntry[];
  /** Page id to the chip of what that page holds. */
  chips: Record<string, LedgerChip>;
}

export const LEDGER_KEY = ['ledger'] as const;

export async function loadLedger(): Promise<LedgerData> {
  const raw = await api<Partial<LedgerData>>('/api/ledger');
  return {
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    chips: raw.chips ?? {},
  };
}
