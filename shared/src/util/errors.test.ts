import { describe, expect, it } from 'vitest';

import {
  STOP_AND_TELL,
  errorMessage,
  featureSwitchOff,
  notFoundMessage,
  unknownToolMessage,
} from './errors.js';

describe('errorMessage', () => {
  it('reads an Error, a string and other values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ a: 1 })).toBe('{"a":1}');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage(7)).toBe('7');
  });

  it('survives a value JSON cannot print', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(typeof errorMessage(loop)).toBe('string');
  });
});

describe('featureSwitchOff', () => {
  it('keeps the wording the dashboard matches and tells Claude to stop', () => {
    const text = featureSwitchOff('The rules check', 'AI Tool: Rules check');
    expect(text).toMatch(/is switched off\. In Foundry, open the Settings tab/);
    expect(text).toContain('turn on "AI Tool: Rules check"');
    expect(text.endsWith(STOP_AND_TELL)).toBe(true);
  });
});

describe('next-step messages', () => {
  it('name the tool to use', () => {
    expect(notFoundMessage('Item 5', 'search-character-items')).toContain('search-character-items');
    expect(unknownToolMessage('foo')).toContain('restart the bridge');
  });
});
