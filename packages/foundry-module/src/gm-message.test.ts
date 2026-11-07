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

  it('copes with missing errors', () => {
    expect(toGmMessage('do it')).toContain('Try again');
  });

  it('uses no em dashes', () => {
    expect(toGmMessage('do it', new Error('x'))).not.toContain(String.fromCharCode(0x2014));
  });
});
