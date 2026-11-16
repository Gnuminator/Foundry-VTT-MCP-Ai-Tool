import { describe, expect, it } from 'vitest';
import { DEBUG_PAYLOAD_MAX_CHARS, capPayload } from './logger.js';

describe('capPayload', () => {
  it('leaves a small payload alone', () => {
    const small = { method: 'x', data: { a: 1 } };
    expect(capPayload(small)).toBe(small);
    expect(capPayload(undefined)).toBeUndefined();
    expect(capPayload('short')).toBe('short');
  });

  it('shortens a large payload to a preview with its size', () => {
    const big = { data: { text: 'secret '.repeat(1000) } };
    const out = capPayload(big) as { truncated: boolean; chars: number; preview: string };
    expect(out.truncated).toBe(true);
    expect(out.chars).toBe(JSON.stringify(big).length);
    expect(out.preview).toHaveLength(DEBUG_PAYLOAD_MAX_CHARS);
  });

  it('does not throw on a circular payload', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(capPayload(a)).toEqual({ truncated: true, preview: '[unserializable payload]' });
  });
});
