/**
 * Tests for the ComfyUI service lifecycle extracted from backend.ts. backend.ts
 * runs a process lock + server bootstrap at import time and can't be loaded in a
 * test, so this lifecycle had zero coverage. With the process spawn, the readiness
 * probe (`fetch`), and the install lookup (`fs.existsSync`) mocked, the start/stop/
 * status state machine is exercised without a real ComfyUI install.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();
vi.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

const existsSyncMock = vi.fn();
vi.mock('fs', () => ({ existsSync: (...args: any[]) => existsSyncMock(...args) }));

import { ComfyUIService } from './comfyui-service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

/** Minimal stand-in for the spawned ChildProcess (EventEmitter + pid/kill/streams). */
function fakeProcess() {
  const proc: any = new EventEmitter();
  proc.pid = 4321;
  proc.killed = false;
  proc.kill = vi.fn();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ComfyUIService.checkStatus', () => {
  it('reports running when ComfyUI answers on 31411', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const svc = new ComfyUIService(logger);
    expect(await svc.checkStatus()).toEqual({
      status: 'running',
      message: 'ComfyUI service is running',
      pid: null,
    });
  });

  it('reports error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const svc = new ComfyUIService(logger);
    expect(await svc.checkStatus()).toMatchObject({
      status: 'error',
      message: 'ComfyUI service encountered an error',
    });
  });

  it('reports stopped when the probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const svc = new ComfyUIService(logger);
    expect(await svc.checkStatus()).toMatchObject({
      status: 'stopped',
      message: 'ComfyUI service is not running',
    });
  });
});

describe('ComfyUIService.stop', () => {
  it('is a no-op when already stopped', async () => {
    const svc = new ComfyUIService(logger);
    expect(await svc.stop()).toEqual({
      status: 'already_stopped',
      message: 'ComfyUI service is already stopped',
    });
  });
});

describe('ComfyUIService.start', () => {
  it('spawns ComfyUI on 31411 and reports running once it is ready', async () => {
    existsSyncMock.mockReturnValue(true); // install + bundled python found on first candidate
    const proc = fakeProcess();
    spawnMock.mockReturnValue(proc);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); // waitForReady passes immediately

    const svc = new ComfyUIService(logger);
    const res = await svc.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['main.py', '--port', '31411', '--listen', '127.0.0.1']),
      expect.objectContaining({ windowsHide: true })
    );
    expect(res).toEqual({
      status: 'running',
      message: 'ComfyUI service started successfully',
      pid: 4321,
    });

    // A second start short-circuits — no extra spawn.
    expect(await svc.start()).toEqual({
      status: 'already_running',
      message: 'ComfyUI service is already running',
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('returns an error result (and never spawns) when ComfyUI is not installed', async () => {
    existsSyncMock.mockReturnValue(false); // findComfyUIPath locates nothing
    const svc = new ComfyUIService(logger);

    const res = await svc.start();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'error' });
    expect(res.message).toContain('ComfyUI installation not found');
  });

  it('reflects running in checkStatus after a successful start', async () => {
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockReturnValue(fakeProcess());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const svc = new ComfyUIService(logger);
    await svc.start();
    const status = await svc.checkStatus();

    expect(status).toMatchObject({ status: 'running', pid: 4321 });
  });
});
