/**
 * The live strip page says who may frame it (live screen B): Foundry's origin from
 * DASHBOARD_FOUNDRY_URL, else the dashboard itself; no other page gets the header.
 */
import { describe, expect, it } from 'vitest';

import { liveFrameAncestors, liveFrameHeader } from './live-frame.js';

describe('liveFrameAncestors', () => {
  it('is the origin of the Foundry address', () => {
    expect(liveFrameAncestors('https://play.example.com')).toBe('https://play.example.com');
    expect(liveFrameAncestors('http://localhost:30001/')).toBe('http://localhost:30001');
  });

  it('drops a path, so only the origin is allowed', () => {
    expect(liveFrameAncestors('https://play.example.com/game')).toBe('https://play.example.com');
  });

  it('falls back to the dashboard itself without a usable address', () => {
    expect(liveFrameAncestors(undefined)).toBe("'self'");
    expect(liveFrameAncestors('')).toBe("'self'");
    expect(liveFrameAncestors('javascript:alert(1)')).toBe("'self'");
    expect(liveFrameAncestors('https://user:pw@play.example.com')).toBe("'self'");
  });
});

describe('liveFrameHeader', () => {
  it('is set for ?strip=1 only', () => {
    const foundry = 'http://localhost:30001';
    expect(liveFrameHeader('/?strip=1', foundry)).toBe('frame-ancestors http://localhost:30001');
    expect(liveFrameHeader('/', foundry)).toBeNull();
    expect(liveFrameHeader('/?strip=0', foundry)).toBeNull();
    expect(liveFrameHeader('/?live=1', foundry)).toBeNull();
  });

  it('reads a repeated strip key the way the page does (the first value)', () => {
    const foundry = 'http://localhost:30001';
    expect(liveFrameHeader('/?strip=1&strip=1', foundry)).not.toBeNull();
    expect(liveFrameHeader('/?strip=1&strip=x', foundry)).not.toBeNull();
    expect(liveFrameHeader('/?strip=x&strip=1', foundry)).toBeNull();
  });
});
