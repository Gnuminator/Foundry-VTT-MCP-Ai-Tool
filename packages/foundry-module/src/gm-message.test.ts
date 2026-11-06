import { describe, expect, it } from 'vitest';
import { toGmMessage } from './gm-message.js';

describe('toGmMessage', () => {
  it('names what failed and never shows the raw error text', () => {
    const msg = toGmMessage(
      'open the live window',
      new Error('TypeError: x is undefined at foo.js:12')
    );
    expect(msg).toMatch(/^Could not open the live window\. /);
    expect(msg).not.toContain('TypeError');
    expect(msg).toContain('F12');
  });

  it('picks a plain reason for known failures', () => {
    expect(toGmMessage('save it', new Error('User lacks permission'))).toContain('permission');
    expect(toGmMessage('save it', new Error('request timed out'))).toContain('too long');
    expect(toGmMessage('save it', new Error('socket not connected'))).toContain('not connected');
  });

  it('copes with strings and missing errors', () => {
    expect(toGmMessage('do it', 'Forbidden')).toContain('permission');
    expect(toGmMessage('do it')).toContain('Try again');
  });

  it('uses no em dashes', () => {
    expect(toGmMessage('do it', new Error('x'))).not.toContain('—');
  });
});
