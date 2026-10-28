/**
 * Shapes of the bridge replies and handler results used by quest-creation.ts.
 * Fields are optional because the bridge may omit them; `unknown` where the value is only
 * passed through and never read.
 */

/** A reply from a journal query (create, read, update). */
export interface QuestBridgeReply {
  error?: unknown;
  success?: unknown;
  id?: unknown;
  name?: unknown;
  pageCount?: number;
  pageId?: unknown;
  pageName?: unknown;
  content?: string;
  currentPage?: unknown;
  allPages?: unknown;
  note?: unknown;
}

/** One page entry inside a journal listing. */
export interface QuestJournalPageInfo {
  id: string;
  name: string;
  type?: string;
}

/** One journal entry in the listJournals reply. */
export interface QuestJournalSummary {
  id: string;
  name: string;
  pageCount?: number;
  pages?: QuestJournalPageInfo[];
  contentPreview?: string;
}

/** The listJournals reply: an array, or an object carrying an error. */
export type QuestJournalListReply = QuestJournalSummary[] & { error?: unknown };

/** A page that matched a journal search. */
export interface QuestMatchedPage {
  pageId: string;
  pageName: string;
  contentSnippet: string;
}

/** One journal that matched a journal search. */
export interface QuestSearchMatch {
  id: string;
  name: string;
  pageCount: number;
  matchType: string[];
  matchedPages: QuestMatchedPage[];
}

/** What the quest handlers return (the fields set depend on the handler and mode). */
export interface QuestToolResult {
  success: boolean;
  mode?: string;
  journalId?: unknown;
  journalName?: unknown;
  pageCount?: unknown;
  content?: unknown;
  message?: string;
  next?: string;
  updateType?: string;
  pageId?: unknown;
  pageName?: unknown;
  verified?: boolean;
  details?: string;
  updatedContent?: string;
  page?: unknown;
  currentPage?: unknown;
  allPages?: unknown;
  note?: unknown;
  journals?: QuestJournalSummary[];
  total?: number;
  filtered?: boolean;
  searchQuery?: string;
  searchType?: string;
  results?: QuestSearchMatch[];
  totalMatches?: number;
}

/** A tool definition as registered with MCP. */
export interface QuestToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
