import { describe, expect, it } from 'vitest';

import { isBridgeRefusal, unwrapBridgeReply } from './bridge-queries.js';

describe('isBridgeRefusal', () => {
  it('is true for a success: false reply', () => {
    expect(isBridgeRefusal({ success: false, error: 'Access denied' })).toBe(true);
  });

  it('is false for replies, null and other values', () => {
    expect(isBridgeRefusal({ success: true })).toBe(false);
    expect(isBridgeRefusal({ status: 'ok' })).toBe(false);
    expect(isBridgeRefusal([])).toBe(false);
    expect(isBridgeRefusal(null)).toBe(false);
    expect(isBridgeRefusal(undefined)).toBe(false);
    expect(isBridgeRefusal('success: false')).toBe(false);
  });
});

describe('unwrapBridgeReply', () => {
  it('returns the reply', () => {
    const reply = { folderId: 'abc', created: false };
    expect(unwrapBridgeReply(reply, 'Folder refused')).toBe(reply);
  });

  it('throws "<what>: <error>" on a refusal', () => {
    expect(() =>
      unwrapBridgeReply({ success: false, error: 'Access denied' }, 'Snapshot refused')
    ).toThrow('Snapshot refused: Access denied');
  });

  it('says "refused by Foundry" when the refusal has no error text', () => {
    const refusal = { success: false } as unknown as { success: false; error: string };
    expect(() => unwrapBridgeReply(refusal, 'Snapshot refused')).toThrow(
      'Snapshot refused: refused by Foundry'
    );
  });
});
