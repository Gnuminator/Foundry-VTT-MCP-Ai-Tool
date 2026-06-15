import { describe, it, expect } from 'vitest';
import {
  parseStandaloneArgs,
  applyStandaloneEnv,
  resolveControlTarget,
} from './standalone-config.js';

describe('parseStandaloneArgs', () => {
  it('defaults to full mode with no host/port', () => {
    expect(parseStandaloneArgs([])).toEqual({ controlOnly: false, help: false });
  });

  it('parses --host and --port (space form)', () => {
    const opts = parseStandaloneArgs(['--host', '0.0.0.0', '--port', '31499']);
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.port).toBe(31499);
  });

  it('parses --port=NNN (equals form)', () => {
    expect(parseStandaloneArgs(['--port=31500']).port).toBe(31500);
  });

  it('parses --control-only', () => {
    expect(parseStandaloneArgs(['--control-only']).controlOnly).toBe(true);
  });

  it('parses -h / --help', () => {
    expect(parseStandaloneArgs(['-h']).help).toBe(true);
    expect(parseStandaloneArgs(['--help']).help).toBe(true);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseStandaloneArgs(['--port', '70000'])).toThrow(/Invalid --port/);
    expect(() => parseStandaloneArgs(['--port', 'abc'])).toThrow(/Invalid --port/);
  });

  it('rejects a missing value', () => {
    expect(() => parseStandaloneArgs(['--port'])).toThrow(/requires a value/);
    expect(() => parseStandaloneArgs(['--host', '--port', '31499'])).toThrow(/requires a value/);
  });

  it('rejects an unknown option', () => {
    expect(() => parseStandaloneArgs(['--bogus'])).toThrow(/Unknown option/);
  });
});

describe('applyStandaloneEnv', () => {
  it('only sets the vars that were provided', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStandaloneEnv({ port: 31499, controlOnly: false, help: false }, env);
    expect(env.MCP_CONTROL_PORT).toBe('31499');
    expect(env.MCP_CONTROL_HOST).toBeUndefined();
    expect(env.MCP_FOUNDRY_LINK).toBeUndefined();
  });

  it('maps control-only to MCP_FOUNDRY_LINK=off', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStandaloneEnv({ controlOnly: true, help: false }, env);
    expect(env.MCP_FOUNDRY_LINK).toBe('off');
  });

  it('sets host when provided', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStandaloneEnv({ host: '127.0.0.1', controlOnly: false, help: false }, env);
    expect(env.MCP_CONTROL_HOST).toBe('127.0.0.1');
  });
});

describe('resolveControlTarget', () => {
  it('falls back to the frozen loopback contract', () => {
    expect(resolveControlTarget({})).toEqual({ host: '127.0.0.1', port: 31414 });
  });

  it('reflects applied env', () => {
    const env: NodeJS.ProcessEnv = {};
    applyStandaloneEnv({ host: '0.0.0.0', port: 31499, controlOnly: false, help: false }, env);
    expect(resolveControlTarget(env)).toEqual({ host: '0.0.0.0', port: 31499 });
  });
});
