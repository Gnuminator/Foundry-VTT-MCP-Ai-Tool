/**
 * Guarded writes log a GM-only `gm-change` event to the session feed. It must
 * reach the GM dashboard and never a player stream, whatever its text says.
 */
import { describe, expect, it } from 'vitest';

import type { SessionEvent } from './feed/types.js';
import { eventsRedactor, redactEventsForPlayer } from './redact.js';
import { SseHub } from './sse.js';

function gmChange(id: string): SessionEvent {
  return {
    id,
    timestamp: '2026-09-28T20:00:00.000Z',
    timestampMs: Date.parse('2026-09-28T20:00:00.000Z'),
    eventType: 'gm-change',
    actorName: null,
    actorId: null,
    description: 'Applied: Strahd attention in Vallaki 2 -> 3',
    details: { changeId: 'chg-1', feature: 'strahd-attention', mode: 'apply' },
  } as SessionEvent;
}

function damage(id: string): SessionEvent {
  return { ...gmChange(id), eventType: 'damage', description: 'Ireena took 4 damage' };
}

class FakeResponse {
  frames: string[] = [];
  writeHead(): void {}
  write(chunk: string): boolean {
    this.frames.push(chunk);
    return true;
  }
  on(): void {}
  end(): void {}
}

const logger = {
  child: (): unknown => logger,
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

describe('gm-change events', () => {
  it('are dropped by the player redaction', () => {
    expect(redactEventsForPlayer([gmChange('e1'), damage('e2')]).map(e => e.id)).toEqual(['e2']);
  });

  it('reach the GM stream and never the player stream', () => {
    const hub = new SseHub(logger as never);
    const gm = new FakeResponse();
    const player = new FakeResponse();
    hub.add(gm as never, 'gm');
    hub.add(player as never, 'player');

    hub.broadcast('events', { events: [gmChange('e1'), damage('e2')] }, eventsRedactor);
    hub.broadcast('events', { events: [gmChange('e3')] }, eventsRedactor);
    hub.close();

    const gmText = gm.frames.join('');
    const playerText = player.frames.join('');
    expect(gmText).toContain('gm-change');
    expect(gmText).toContain('Strahd attention');
    expect(playerText).toContain('Ireena took 4 damage');
    expect(playerText).not.toContain('gm-change');
    expect(playerText).not.toContain('Strahd');
    expect(playerText).not.toContain('chg-1');
  });
});
