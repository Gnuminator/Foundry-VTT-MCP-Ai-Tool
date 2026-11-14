import { describe, expect, it } from 'vitest';

import {
  cleanClientVersion,
  clientDownloadUrl,
  clientNoticeText,
  clientToolNotice,
  compareClientVersions,
  isClientBehind,
  parseClientHeader,
  playerExtensionVersion,
} from './client-versions.js';

describe('client versions', () => {
  it('cleans a reported version to x.y.z', () => {
    expect(cleanClientVersion('0.28.0')).toBe('0.28.0');
    expect(cleanClientVersion('v0.28.1')).toBe('0.28.1');
    expect(cleanClientVersion('0.29.0-beta.1')).toBe('0.29.0');
    expect(cleanClientVersion('latest')).toBeNull();
    expect(cleanClientVersion(28)).toBeNull();
    expect(cleanClientVersion('0.28.0<script>')).toBeNull();
  });

  it('compares numerically', () => {
    expect(compareClientVersions('0.9.0', '0.28.0')).toBe(-1);
    expect(compareClientVersions('0.28', '0.28.0')).toBe(0);
    expect(compareClientVersions('1.0.0', '0.28.0')).toBe(1);
  });

  it('never calls a missing version behind', () => {
    expect(isClientBehind(null, '0.28.0')).toBe(false);
    expect(isClientBehind('0.27.0', '0.28.0')).toBe(true);
    expect(isClientBehind('0.28.0', '0.28.0')).toBe(false);
    expect(isClientBehind('0.29.0', '0.28.0')).toBe(false);
  });

  it('reads the player extension user-agent', () => {
    expect(playerExtensionVersion('foundry-player-connector/0.2.0')).toBe('0.2.0');
    expect(playerExtensionVersion('node foundry-player-connector/0.28.0')).toBe('0.28.0');
    expect(playerExtensionVersion('curl/8.0')).toBeNull();
    expect(playerExtensionVersion(undefined)).toBeNull();
  });

  it('reads the client header', () => {
    expect(parseClientHeader('obsidian/0.28.0')).toEqual({ piece: 'obsidian', version: '0.28.0' });
    expect(parseClientHeader('Obsidian/0.28.0 ')).toEqual({ piece: 'obsidian', version: '0.28.0' });
    expect(parseClientHeader('other/1.0.0')).toBeNull();
    expect(parseClientHeader('obsidian/x')).toBeNull();
    expect(parseClientHeader(['obsidian/0.28.0'])).toBeNull();
  });

  it('points downloads at the release the Pi runs', () => {
    expect(clientDownloadUrl('connectors', '0.28.0')).toMatch(
      /\/releases\/download\/v0\.28\.0\/FoundryMCPServer-Setup-v0\.28\.0\.exe$/
    );
    expect(clientDownloadUrl('obsidian', '0.28.0')).toMatch(
      /\/v0\.28\.0\/foundry-ai-tool-obsidian\.zip$/
    );
    expect(clientDownloadUrl('player-extension', '0.28.0')).toBeNull();
  });

  it('writes Danish and English notices without em dashes', () => {
    for (const piece of ['connectors', 'player-extension', 'obsidian'] as const) {
      const n = clientNoticeText(piece, '0.27.0', '0.28.0');
      expect(n.da).toContain('0.27.0');
      expect(n.da).toContain('0.28.0');
      expect(n.en).toContain('Update available');
      const line = clientToolNotice(piece, null, '0.28.0');
      expect(line).toContain('an older version');
      expect(`${n.da}${n.en}${line}`).not.toContain(String.fromCharCode(0x2014));
    }
    expect(clientNoticeText('player-extension', '0.2.0', '0.28.0').en).toContain(
      'Download my helper'
    );
  });

  // The Obsidian plugin bundles without this package and keeps a copy of the wording: the copy
  // must say exactly what the shared text says.
  it('matches the Obsidian plugin copy of the wording', async () => {
    const { updateNotice } = await import('../../packages/obsidian-plugin/src/client-update.js');
    const link = clientDownloadUrl('obsidian', '0.28.0');
    const shared = clientNoticeText('obsidian', '0.27.0', '0.28.0', link);
    expect(updateNotice('0.27.0', '0.28.0', link)?.title).toBe(`${shared.da}\n${shared.en}`);
    const noLink = clientNoticeText('obsidian', '0.27.0', '0.28.0', null);
    expect(updateNotice('0.27.0', '0.28.0', null)?.title).toBe(`${noLink.da}\n${noLink.en}`);
  });
});
