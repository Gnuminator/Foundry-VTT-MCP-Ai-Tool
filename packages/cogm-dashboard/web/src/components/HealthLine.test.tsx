// The GM health line and the page crash net: the strip texts, the screen reader line, the detail
// that works without hover, and the crash page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { HealthPart } from '../lib/health';
import {
  BRIDGE_STATUS_KEY,
  RECORDING_HEALTH_KEY,
  STREAM_HEARD_KEY,
  STREAM_LINK_KEY,
  type BridgeStatus,
} from '../lib/stream';
import { HealthLine, troubleAnnouncement } from './HealthLine';
import { RootBoundary } from './RootBoundary';

// stream.ts pulls in auth.ts, which reads the page's location when it loads; there is no page here.
vi.mock('../lib/auth', () => ({ streamUrl: (): string => '/api/stream' }));
vi.mock('../lib/api', () => ({ callTool: vi.fn() }));

const GOOD: BridgeStatus = {
  controlChannel: 'connected',
  foundry: 'reachable',
  lastError: null,
  lastPollAt: new Date().toISOString(),
  foundryDownSince: null,
};

function render(status: BridgeStatus | undefined, recording?: unknown): string {
  const qc = new QueryClient();
  qc.setQueryData(STREAM_LINK_KEY, { state: 'open', since: Date.now() });
  qc.setQueryData(STREAM_HEARD_KEY, Date.now());
  if (status) qc.setQueryData(BRIDGE_STATUS_KEY, status);
  if (recording) qc.setQueryData(RECORDING_HEALTH_KEY, recording);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <HealthLine />
    </QueryClientProvider>
  );
}

describe('HealthLine', () => {
  it('is quiet when all is well: four parts, no trouble flag, an empty status line', () => {
    const html = render(GOOD);
    expect(html).toContain('Connection health');
    expect(html).not.toContain('data-trouble');
    expect(html).toMatch(/data-health-status=""[^>]*><\/span>/);
  });

  it('says "The bridge is away." text as "away" and names the part for a screen reader', () => {
    const html = render({ ...GOOD, controlChannel: 'disconnected' });
    expect(html).toContain('data-trouble');
    expect(html).toContain('away');
    expect(html).toContain('Needs attention: Bridge.');
  });

  it('says Foundry is down, with the time', () => {
    const html = render({
      ...GOOD,
      foundry: 'unreachable',
      foundryDownSince: '2026-11-06T20:14:00.000Z',
    });
    expect(html).toContain('down since');
    expect(html).toContain('Needs attention: Foundry.');
  });

  it('gives a dot with details a button for touch, as well as the hover title', () => {
    const html = render(GOOD, {
      recorder: null,
      playLog: { tone: 'warn', text: 'errors', detail: 'the log had an error' },
    });
    expect(html).toContain('title="the log had an error"');
    expect(html).toContain('aria-label="Details about Play log"');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('troubleAnnouncement', () => {
  it('lists the red parts only, and changes only when the red parts change', () => {
    const part = (
      key: 'bridge' | 'foundry' | 'update',
      tone: 'ok' | 'bad' | 'warn'
    ): HealthPart => ({ key, label: key, tone, text: 'x' });
    expect(troubleAnnouncement([part('bridge', 'ok'), part('update', 'warn')])).toBe('');
    expect(troubleAnnouncement([part('bridge', 'bad'), part('foundry', 'bad')])).toBe(
      'Needs attention: bridge, foundry.'
    );
  });
});

describe('RootBoundary', () => {
  it('shows the crash page with the shared Button when a render failed', () => {
    const boundary = new RootBoundary({ children: null });
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('id="page-crashed"');
    expect(html).toContain('This page stopped working');
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('Reload the page');
  });

  it('flags a failure from a throwing child', () => {
    expect(RootBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });
});
