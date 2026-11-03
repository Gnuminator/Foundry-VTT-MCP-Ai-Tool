/**
 * `showJournalPage({uuid, userIds?})` (I-110 "Show it now"): pops a journal page (or a whole
 * journal) up on the players' screens through Foundry's own Show Players. A write (write-gate.ts):
 * it changes what the players see, so it obeys "Allow Write Operations". GM-only.
 * `force` is always false: a client only renders it when it can see the parent journal, so a
 * player the page is not revealed to never gets it.
 */
const MAX_USERS = 50;

export async function showJournalPage(
  data: unknown
): Promise<{ shown: true; uuid: string; users: string[] }> {
  const { uuid, userIds } = (data ?? {}) as { uuid?: unknown; userIds?: unknown };
  if (typeof uuid !== 'string' || !uuid) throw new Error('showJournalPage needs a uuid');
  if (
    userIds !== undefined &&
    (!Array.isArray(userIds) ||
      userIds.length > MAX_USERS ||
      userIds.some(u => typeof u !== 'string' || !u))
  ) {
    throw new Error('showJournalPage userIds must be a list of user ids');
  }
  const users = (userIds as string[] | undefined) ?? [];
  const doc = await fromUuid(uuid);
  if (!doc) throw new Error(`Document not found: ${uuid}`);
  if (doc.documentName !== 'JournalEntryPage' && doc.documentName !== 'JournalEntry') {
    throw new Error(`Only a journal page or journal can be shown, not ${doc.documentName}`);
  }
  // The namespaced class: the bare `Journal` global is a v13 shim that warns (removed in v15).
  await foundry.documents.collections.Journal.show(doc, { force: false, users });
  return { shown: true, uuid, users };
}

/**
 * The chat line of a handout notice: the page's title as a click-to-open link, and nothing of the
 * page itself. Foundry turns `@UUID[...]{title}` into a link when the message renders; the title
 * loses the characters that would end the link early.
 */
export function handoutNoticeContent(uuid: string, title: string): string {
  const label =
    title
      .replace(/[\][{}<>&"]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'a handout';
  return `<p>A handout was revealed to you: @UUID[${uuid}]{${label}}</p>`;
}

/**
 * `postHandoutNotice({uuid, userIds?})`: after a handout reveal, whisper a short chat message to
 * the players it was revealed to (every non-GM user who can observe the page when `userIds` is
 * empty), so Foundry alone is enough to notice it. A write (write-gate.ts), GM-only. Never posts
 * a public message: with nobody to tell it posts nothing.
 */
export async function postHandoutNotice(
  data: unknown
): Promise<{ posted: boolean; uuid: string; users: string[] }> {
  const { uuid, userIds } = (data ?? {}) as { uuid?: unknown; userIds?: unknown };
  if (typeof uuid !== 'string' || !uuid) throw new Error('postHandoutNotice needs a uuid');
  if (
    userIds !== undefined &&
    (!Array.isArray(userIds) ||
      userIds.length > MAX_USERS ||
      userIds.some(u => typeof u !== 'string' || !u))
  ) {
    throw new Error('postHandoutNotice userIds must be a list of user ids');
  }
  const asked = (userIds as string[] | undefined) ?? [];
  const doc = await fromUuid(uuid);
  if (!doc) throw new Error(`Document not found: ${uuid}`);
  if (doc.documentName !== 'JournalEntryPage' && doc.documentName !== 'JournalEntry') {
    throw new Error(`Only a journal page or journal can be announced, not ${doc.documentName}`);
  }
  const users = (game.users?.contents ?? []) as Array<{ id: string; isGM: boolean }>;
  const target = doc as unknown as {
    name?: string;
    testUserPermission?: (user: unknown, level: string) => boolean;
  };
  // Only players who can open the page, named or not: a link that opens nothing is no notice.
  const recipients = users
    .filter(u => (asked.length === 0 || asked.includes(u.id)) && !u.isGM)
    .filter(u => target.testUserPermission?.(u, 'OBSERVER') === true)
    .map(u => u.id);
  if (recipients.length === 0) return { posted: false, uuid, users: [] };
  await ChatMessage.create({
    content: handoutNoticeContent(uuid, target.name ?? ''),
    // Explicit and neutral: getSpeaker with only an alias takes the GM's selected token, and dnd5e
    // would show that actor's portrait (a hidden monster, say) on the players' whisper.
    speaker: { scene: null, actor: null, token: null, alias: 'Handout' },
    whisper: recipients,
  });
  return { posted: true, uuid, users: recipients };
}
