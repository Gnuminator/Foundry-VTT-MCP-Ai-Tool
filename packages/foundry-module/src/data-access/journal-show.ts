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
