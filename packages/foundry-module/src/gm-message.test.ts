import { describe, expect, it } from 'vitest';
import { toGmMessage } from './gm-message.js';

describe('toGmMessage', () => {
  it('hides technical error text behind a plain hint', () => {
    const msg = toGmMessage('open the live window', new TypeError('x is undefined at foo.js:12'));
    expect(msg).toMatch(/^Could not open the live window\. /);
    expect(msg).not.toContain('undefined');
    expect(msg).toContain('F12');
  });

  it('keeps a sentence the tool wrote for people', () => {
    expect(toGmMessage('start the roll', new Error('Select a token first'))).toBe(
      'Could not start the roll. Select a token first.'
    );
    expect(toGmMessage('x', new Error('The AI Tool is not connected.'))).toContain(
      'The AI Tool is not connected.'
    );
  });

  it('picks a plain reason for low-level failures', () => {
    expect(toGmMessage('save it', new Error('request timed out'))).toContain('too long');
    expect(toGmMessage('save it', new Error('Failed to fetch'))).toContain('not connected');
    expect(toGmMessage('save it', new Error('socket closed'))).toContain('not connected');
    expect(toGmMessage('save it', 'forbidden')).toContain('permission');
  });

  it('does not pass id-shaped text through', () => {
    const msg = toGmMessage('run that roll', new Error('ChatMessage a1B2c3D4e5F6g7H8 is gone'));
    expect(msg).not.toContain('a1B2c3D4e5F6g7H8');
    expect(
      toGmMessage('x', new Error('Reveal JournalEntry.AAAAAAAAAAAAAAAA.JournalEntryPage.x failed'))
    ).not.toContain('AAAAAAAAAAAAAAAA');
    expect(toGmMessage('x', new Error('Select a token first'))).toContain('Select a token first');
  });

  it('tells a player to ask the GM instead of opening the console', () => {
    const msg = toGmMessage('run that roll', new Error('x is undefined'), 'player');
    expect(msg).toContain('tell your GM');
    expect(msg).not.toContain('F12');
  });

  it('names the known reasons for a player in player words', () => {
    expect(toGmMessage('x', new Error('request forbidden here'), 'player')).toContain(
      'Ask your GM'
    );
    const dropped = toGmMessage('x', new Error('socket closed'), 'player');
    expect(dropped).toContain('Ask your GM');
    expect(dropped).not.toContain('Check that it is running');
    expect(toGmMessage('x', new Error('socket closed'))).toContain('Check that it is running');
  });

  it('treats a 16-character id with no digit as an id', () => {
    expect(toGmMessage('x', new Error('Reveal aBcdefghijklmnop failed badly today'))).not.toContain(
      'aBcdefghijklmnop'
    );
  });

  it('copes with missing errors', () => {
    expect(toGmMessage('do it')).toContain('Try again');
  });

  it('uses no em dashes', () => {
    expect(toGmMessage('do it', new Error('x'))).not.toContain(String.fromCharCode(0x2014));
  });
});
