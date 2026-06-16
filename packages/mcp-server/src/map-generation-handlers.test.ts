/**
 * Tests for the map-generation request handlers extracted from backend.ts.
 *
 * These were previously buried in backend.ts, which runs the process lock + a
 * server bootstrap at import time and so can't be loaded in a test. Pulled into
 * their own module, the three request handlers are unit-testable with stub
 * jobQueue / comfyuiClient / foundryClient. The background pipeline
 * (processMapGenerationInBackend) is detached fire-and-forget and pure
 * orchestration (no filesystem access).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleGenerateMapRequest,
  handleCheckMapStatusRequest,
  handleCancelMapJobRequest,
} from './map-generation-handlers.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleCheckMapStatusRequest
// ---------------------------------------------------------------------------

describe('handleCheckMapStatusRequest', () => {
  it('errors when no request data is supplied', async () => {
    expect(await handleCheckMapStatusRequest(null, {}, logger)).toEqual({
      status: 'error',
      message: 'Request data is required',
    });
  });

  it('errors when job_id is missing', async () => {
    expect(await handleCheckMapStatusRequest({}, {}, logger)).toEqual({
      status: 'error',
      message: 'Job ID is required',
    });
  });

  it('errors when the job is not found', async () => {
    const jobQueue = { getJob: vi.fn().mockResolvedValue(null) };
    expect(await handleCheckMapStatusRequest({ job_id: 'j1' }, jobQueue, logger)).toEqual({
      status: 'error',
      message: 'Job j1 not found',
    });
  });

  it('projects only the whitelisted job fields on success', async () => {
    const job = {
      id: 'j1',
      status: 'running',
      progress_percent: 40,
      current_stage: 'gen',
      result: null,
      error: null,
      secret: 'should-not-leak',
    };
    const jobQueue = { getJob: vi.fn().mockResolvedValue(job) };

    const res = await handleCheckMapStatusRequest({ job_id: 'j1' }, jobQueue, logger);

    expect(res).toEqual({
      status: 'success',
      job: {
        id: 'j1',
        status: 'running',
        progress_percent: 40,
        current_stage: 'gen',
        result: null,
        error: null,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// handleCancelMapJobRequest
// ---------------------------------------------------------------------------

describe('handleCancelMapJobRequest', () => {
  it('errors when no request data is supplied', async () => {
    expect(await handleCancelMapJobRequest(null, {}, {}, logger)).toEqual({
      status: 'error',
      message: 'Request data is required',
    });
  });

  it('errors when job_id is missing', async () => {
    expect(await handleCancelMapJobRequest({}, {}, {}, logger)).toEqual({
      status: 'error',
      message: 'Job ID is required',
    });
  });

  it('errors when the job is not found', async () => {
    const jobQueue = { getJob: vi.fn().mockResolvedValue(null) };
    expect(await handleCancelMapJobRequest({ job_id: 'j1' }, jobQueue, {}, logger)).toEqual({
      status: 'error',
      message: 'Job not found',
    });
  });

  it('cancels in ComfyUI (when a prompt id is present) and in the queue', async () => {
    const jobQueue = {
      getJob: vi.fn().mockResolvedValue({ id: 'j1', comfyui_job_id: 'p1' }),
      cancelJob: vi.fn().mockResolvedValue(true),
    };
    const comfyuiClient = { cancelJob: vi.fn().mockResolvedValue(true) };

    const res = await handleCancelMapJobRequest({ job_id: 'j1' }, jobQueue, comfyuiClient, logger);

    expect(comfyuiClient.cancelJob).toHaveBeenCalledWith('p1');
    expect(jobQueue.cancelJob).toHaveBeenCalledWith('j1');
    expect(res).toEqual({ status: 'success', message: 'Job cancelled successfully' });
  });

  it('reports failure (and skips ComfyUI) when the queue cancel returns false', async () => {
    const jobQueue = {
      getJob: vi.fn().mockResolvedValue({ id: 'j1' }), // no comfyui_job_id
      cancelJob: vi.fn().mockResolvedValue(false),
    };
    const comfyuiClient = { cancelJob: vi.fn() };

    const res = await handleCancelMapJobRequest({ job_id: 'j1' }, jobQueue, comfyuiClient, logger);

    expect(comfyuiClient.cancelJob).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'error', message: 'Failed to cancel job' });
  });
});

// ---------------------------------------------------------------------------
// handleGenerateMapRequest
// ---------------------------------------------------------------------------

describe('handleGenerateMapRequest', () => {
  it('errors when the map-generation components are not initialized', async () => {
    const res = await handleGenerateMapRequest(
      { data: { prompt: 'p', scene_name: 's' } },
      null,
      null,
      logger,
      {}
    );
    expect(res).toEqual({ status: 'error', message: 'Map generation components not initialized' });
  });

  it('errors when the prompt is missing', async () => {
    const res = await handleGenerateMapRequest({ data: { scene_name: 's' } }, {}, {}, logger, {});
    expect(res).toEqual({ status: 'error', message: 'Prompt is required and must be a string' });
  });

  it('errors when the scene name is missing', async () => {
    const res = await handleGenerateMapRequest({ data: { prompt: 'p' } }, {}, {}, logger, {});
    expect(res).toEqual({
      status: 'error',
      message: 'Scene name is required and must be a string',
    });
  });

  it('enqueues a job and returns success (background run is detached)', async () => {
    const jobQueue = {
      createJob: vi.fn().mockResolvedValue({ id: 'job1' }),
      // background calls getJob → undefined → fails fast + harmlessly
      getJob: vi.fn().mockResolvedValue(undefined),
      markJobFailed: vi.fn().mockResolvedValue(undefined),
    };
    const foundryClient = { sendMessage: vi.fn() };

    const res = await handleGenerateMapRequest(
      { data: { prompt: 'a cave', scene_name: 'Cave' } },
      jobQueue,
      {},
      logger,
      foundryClient
    );

    expect(jobQueue.createJob).toHaveBeenCalledWith({
      params: expect.objectContaining({ prompt: 'a cave', scene_name: 'Cave' }),
    });
    expect(res).toMatchObject({ status: 'success', jobId: 'job1' });

    // Flush the detached background run so it settles before teardown.
    await vi.waitFor(() => expect(jobQueue.markJobFailed).toHaveBeenCalled());
  });
});
