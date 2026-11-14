import { describe, expect, it } from 'vitest';

import { clientHeaderValue, compareVersions, updateNotice } from './client-update.js';
import { DashboardClient, type HttpRequest } from './dashboard.js';

describe('client header', () => {
  it('is obsidian/<version>', () => {
    expect(clientHeaderValue('0.28.0')).toBe('obsidian/0.28.0');
  });

  it('goes on every request when the plugin version is known, and not otherwise', async () => {
    const calls: HttpRequest[] = [];
    const http = (req: HttpRequest): Promise<{ status: number; json: unknown }> => {
      calls.push(req);
      return Promise.resolve({ status: 200, json: { theme: 'default' } });
    };
    const withVersion = new DashboardClient(
      http,
      () => 'http://localhost:3000',
      () => null,
      () => null,
      () => '0.28.0'
    );
    await withVersion.theme().catch(() => undefined);
    await withVersion.clientVersions();
    expect(calls.map(c => c.headers['x-foundry-client'])).toEqual([
      'obsidian/0.28.0',
      'obsidian/0.28.0',
    ]);

    calls.length = 0;
    const bare = new DashboardClient(
      http,
      () => 'http://localhost:3000',
      () => null
    );
    await bare.clientVersions();
    expect(calls[0]?.headers['x-foundry-client']).toBeUndefined();
  });
});

describe('outdated decision', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('0.9.0', '0.28.0')).toBe(-1);
    expect(compareVersions('0.28.0', '0.28.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.28.9')).toBe(1);
  });

  it('gives a notice only when older, with Danish then English hover text', () => {
    const link = 'https://example.org/foundry-ai-tool-obsidian.zip';
    const n = updateNotice('0.27.0', '0.28.0', link);
    expect(n?.text).toBe('Foundry AI Tool: opdatering 0.28.0');
    expect(n?.link).toBe(link);
    const [da, en] = (n?.title ?? '').split('\n');
    expect(da).toContain('Opdatering klar');
    expect(en).toContain('Update available');
    expect(updateNotice('0.28.0', '0.28.0', link)).toBeNull();
    expect(updateNotice('0.29.0', '0.28.0', link)).toBeNull();
  });

  it('stays silent on unusable answers and drops a non-http link', () => {
    expect(updateNotice('0.27.0', undefined, null)).toBeNull();
    expect(updateNotice('0.27.0', 'soon', null)).toBeNull();
    expect(updateNotice('0.27.0', '0.28.0', 'javascript:alert(1)')?.link).toBeNull();
  });

  it('clientVersions is null on a 404 or a failure', async () => {
    const notFound = new DashboardClient(
      () => Promise.resolve({ status: 404, json: null }),
      () => 'http://localhost:3000',
      () => null
    );
    expect(await notFound.clientVersions()).toBeNull();
    const down = new DashboardClient(
      () => Promise.reject(new Error('down')),
      () => 'http://localhost:3000',
      () => null
    );
    expect(await down.clientVersions()).toBeNull();
  });
});
