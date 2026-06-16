import { describe, expect, it, vi } from 'vitest';

import { MapGenerationTools } from './map-generation.js';

/**
 * Tests for MapGenerationTools — a thin, deterministic layer over FoundryClient.query.
 * Pattern: validate args → dispatch correct `foundry-mcp-bridge.*` method →
 * propagate foundry-side failures → return validation errors as strings.
 *
 * Note: MapGenerationTools also accepts an optional `backendComfyUIHandlers` option,
 * but ALL five handlers (generateMap, checkMapStatus, cancelMapJob, listScenes,
 * switchScene) route exclusively through `foundryClient.query` — the handlers
 * field is stored but never called by any current public method.
 *
 * The FoundryClient is mocked so these tests run with no bridge connection.
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(queryImpl ?? (() => ({ success: true })));
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  // backendComfyUIHandlers is optional; provide a stub so the constructor stores it.
  const backendComfyUIHandlers = { handleMessage: vi.fn() };
  return {
    tools: new MapGenerationTools({ foundryClient, logger, backendComfyUIHandlers }),
    query,
    backendComfyUIHandlers,
  };
}

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('MapGenerationTools.getToolDefinitions', () => {
  it('exposes the five map tools with object input schemas', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual([
      'generate-map',
      'check-map-status',
      'cancel-map-job',
      'list-scenes',
      'switch-scene',
    ]);
    for (const d of defs) {
      expect((d.inputSchema as any).type).toBe('object');
    }
  });

  it('generate-map requires prompt and scene_name', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'generate-map')!;
    expect((def.inputSchema as any).required).toEqual(['prompt', 'scene_name']);
  });

  it('check-map-status requires job_id', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'check-map-status')!;
    expect((def.inputSchema as any).required).toEqual(['job_id']);
  });

  it('cancel-map-job requires job_id', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'cancel-map-job')!;
    expect((def.inputSchema as any).required).toEqual(['job_id']);
  });

  it('list-scenes has no required fields', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'list-scenes')!;
    expect((def.inputSchema as any).required).toBeUndefined();
  });

  it('switch-scene requires scene_identifier', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const def = defs.find(d => d.name === 'switch-scene')!;
    expect((def.inputSchema as any).required).toEqual(['scene_identifier']);
  });
});

// ---------------------------------------------------------------------------
// generateMap
// ---------------------------------------------------------------------------

describe('MapGenerationTools.generateMap', () => {
  it('dispatches generate-map to foundryClient.query with validated params', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      jobId: 'job_abc',
      estimatedTime: '60s',
    }));
    const result = await tools.generateMap({
      prompt: 'dark forest',
      scene_name: 'Dark Woods',
      size: 'large',
      grid_size: 100,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.generate-map', {
      prompt: 'dark forest',
      scene_name: 'Dark Woods',
      size: 'large',
      grid_size: 100,
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('job_abc');
    expect(result as string).toContain('dark forest');
  });

  it('defaults size to "medium" and grid_size to 70 when omitted', async () => {
    const { tools, query } = makeTools(() => ({ success: true, jobId: 'job_def' }));
    await tools.generateMap({ prompt: 'tavern', scene_name: 'Tavern' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.generate-map', {
      prompt: 'tavern',
      scene_name: 'Tavern',
      size: 'medium',
      grid_size: 70,
    });
  });

  it('returns an error string (not a throw) when prompt is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.generateMap({ scene_name: 'Dark Woods' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Prompt is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string when prompt is an empty string', async () => {
    const { tools, query } = makeTools();
    const result = await tools.generateMap({ prompt: '   ', scene_name: 'Dark Woods' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Prompt is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string (not a throw) when scene_name is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.generateMap({ prompt: 'forest' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Scene name is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string when scene_name is an empty string', async () => {
    const { tools, query } = makeTools();
    const result = await tools.generateMap({ prompt: 'forest', scene_name: '   ' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Scene name is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string when called with null/undefined input', async () => {
    const { tools, query } = makeTools();
    const result = await tools.generateMap(undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Prompt is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string (not a throw) when foundry response contains an error', async () => {
    const { tools } = makeTools(() => ({ success: false, error: 'ComfyUI unavailable' }));
    const result = await tools.generateMap({ prompt: 'cave', scene_name: 'Cave' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/ComfyUI unavailable/);
  });

  it('includes size pixel info in the returned string', async () => {
    const { tools } = makeTools(() => ({ success: true, jobId: 'j1' }));
    const result = await tools.generateMap({ prompt: 'lake', scene_name: 'Lake', size: 'small' });
    expect(result as string).toContain('1024x1024');
  });
});

// ---------------------------------------------------------------------------
// checkMapStatus
// ---------------------------------------------------------------------------

describe('MapGenerationTools.checkMapStatus', () => {
  it('dispatches check-map-status to foundryClient.query with the job_id', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      job: { status: 'queued', current_stage: 'Pending', progress_percent: 0 },
    }));
    await tools.checkMapStatus({ job_id: 'job_123' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.check-map-status', {
      job_id: 'job_123',
    });
  });

  it('returns an error string (not a throw) when job_id is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.checkMapStatus({});
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/job_id is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string when called with null/undefined input', async () => {
    const { tools, query } = makeTools();
    const result = await tools.checkMapStatus(undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/job_id is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts jobId as alias for job_id', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      job: { status: 'complete', result: {} },
    }));
    await tools.checkMapStatus({ jobId: 'job_999' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.check-map-status', {
      job_id: 'job_999',
    });
  });

  it('returns a "not found" string when job is missing from response', async () => {
    const { tools } = makeTools(() => ({ success: true }));
    const result = await tools.checkMapStatus({ job_id: 'job_gone' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('job_gone');
    expect(result as string).toMatch(/not found/i);
  });

  it('returns a queued string for queued status', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      job: { status: 'queued', current_stage: 'Waiting', progress_percent: 0 },
    }));
    const result = await tools.checkMapStatus({ job_id: 'job_q' });
    expect(result as string).toContain('queued');
  });

  it('returns a progress string for generating status', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      job: { status: 'generating', current_stage: 'Diffusing', progress_percent: 42 },
    }));
    const result = await tools.checkMapStatus({ job_id: 'job_g' });
    expect(result as string).toContain('42');
  });

  it('returns a progress string for processing status', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      job: { status: 'processing', current_stage: 'Upscaling', progress_percent: 80 },
    }));
    const result = await tools.checkMapStatus({ job_id: 'job_p' });
    expect(result as string).toContain('80');
  });

  it('returns a completion string for complete status', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      job: { status: 'complete', result: { generation_time_ms: 12000 } },
    }));
    const result = await tools.checkMapStatus({ job_id: 'job_done' });
    expect(result as string).toMatch(/completed/i);
    expect(result as string).toContain('12');
  });

  it('returns a failed string for failed status', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      job: { status: 'failed', error: 'GPU OOM' },
    }));
    const result = await tools.checkMapStatus({ job_id: 'job_fail' });
    expect(result as string).toContain('failed');
    expect(result as string).toContain('GPU OOM');
  });

  it('returns an expired string for expired status', async () => {
    const { tools } = makeTools(() => ({ success: true, job: { status: 'expired' } }));
    const result = await tools.checkMapStatus({ job_id: 'job_exp' });
    expect(result as string).toContain('expired');
  });

  it('returns an error string (not a throw) when response contains an error', async () => {
    const { tools } = makeTools(() => ({
      success: false,
      error: 'server error',
      message: 'Bridge down',
    }));
    const result = await tools.checkMapStatus({ job_id: 'job_err' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Bridge down/);
  });

  it('returns an error string (not a throw) when query throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('network failure');
    });
    const result = await tools.checkMapStatus({ job_id: 'job_throw' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/network failure/);
  });
});

// ---------------------------------------------------------------------------
// cancelMapJob
// ---------------------------------------------------------------------------

describe('MapGenerationTools.cancelMapJob', () => {
  it('dispatches cancel-map-job to foundryClient.query with the job_id', async () => {
    const { tools, query } = makeTools(() => ({
      success: true,
      message: 'Cancelled',
      status: 'cancelled',
    }));
    await tools.cancelMapJob({ job_id: 'job_123' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.cancel-map-job', { job_id: 'job_123' });
  });

  it('returns a success message with status on successful cancel', async () => {
    const { tools } = makeTools(() => ({
      success: true,
      message: 'Job cancelled',
      status: 'cancelled',
    }));
    const result = await tools.cancelMapJob({ job_id: 'job_abc' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('cancelled');
    expect(result as string).toContain('Job cancelled');
  });

  it('returns an error string (not a throw) when job_id is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.cancelMapJob({});
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/job_id is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error string when called with null/undefined input', async () => {
    const { tools, query } = makeTools();
    const result = await tools.cancelMapJob(undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/job_id is required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts jobId as alias for job_id', async () => {
    const { tools, query } = makeTools(() => ({ success: true, status: 'cancelled' }));
    await tools.cancelMapJob({ jobId: 'job_999' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.cancel-map-job', { job_id: 'job_999' });
  });

  it('returns an error string (not a throw) when response contains an error', async () => {
    const { tools } = makeTools(() => ({
      success: false,
      error: 'not found',
      message: 'Job not found',
    }));
    const result = await tools.cancelMapJob({ job_id: 'job_gone' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/Job not found/);
  });

  it('returns an error string (not a throw) when query throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('connection lost');
    });
    const result = await tools.cancelMapJob({ job_id: 'job_throw' });
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/connection lost/);
  });

  it('uses "success" as status fallback when response has no status string but success=true', async () => {
    const { tools } = makeTools(() => ({ success: true }));
    const result = await tools.cancelMapJob({ job_id: 'job_nostatus' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('success');
  });
});

// ---------------------------------------------------------------------------
// listScenes
// ---------------------------------------------------------------------------

describe('MapGenerationTools.listScenes', () => {
  it('dispatches list-scenes to foundryClient.query with filter and include_active_only', async () => {
    const payload = { success: true, scenes: [] };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.listScenes({ filter: 'tavern', include_active_only: true });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.list-scenes', {
      filter: 'tavern',
      include_active_only: true,
    });
    expect(result).toBe(payload);
  });

  it('omits filter when not a string and defaults include_active_only to false', async () => {
    const { tools, query } = makeTools(() => ({ success: true, scenes: [] }));
    await tools.listScenes({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.list-scenes', {
      filter: undefined,
      include_active_only: false,
    });
  });

  it('handles null/undefined input gracefully', async () => {
    const { tools, query } = makeTools(() => ({ success: true, scenes: [] }));
    await tools.listScenes(undefined);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.list-scenes', {
      filter: undefined,
      include_active_only: false,
    });
  });

  it('returns an error object (not a throw) when query throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('bridge offline');
    });
    const result = await tools.listScenes({});
    expect(result).toMatchObject({ success: false, error: 'bridge offline' });
  });
});

// ---------------------------------------------------------------------------
// switchScene
// ---------------------------------------------------------------------------

describe('MapGenerationTools.switchScene', () => {
  it('dispatches switch-scene to foundryClient.query with scene_identifier', async () => {
    const payload = { success: true };
    const { tools, query } = makeTools(() => payload);
    const result = await tools.switchScene({
      scene_identifier: 'Tavern Scene',
      optimize_view: false,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.switch-scene', {
      scene_identifier: 'Tavern Scene',
      optimize_view: false,
    });
    expect(result).toBe(payload);
  });

  it('defaults optimize_view to true when not provided', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.switchScene({ scene_identifier: 'Forest' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.switch-scene', {
      scene_identifier: 'Forest',
      optimize_view: true,
    });
  });

  it('accepts sceneId as alias for scene_identifier', async () => {
    const { tools, query } = makeTools(() => ({ success: true }));
    await tools.switchScene({ sceneId: 'scene-001' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.switch-scene', {
      scene_identifier: 'scene-001',
      optimize_view: true,
    });
  });

  it('returns an error object (not a throw) when scene_identifier is missing', async () => {
    const { tools, query } = makeTools();
    const result = await tools.switchScene({});
    expect(result).toMatchObject({ success: false, error: 'scene_identifier is required' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error object when called with null/undefined input', async () => {
    const { tools, query } = makeTools();
    const result = await tools.switchScene(undefined);
    expect(result).toMatchObject({ success: false, error: 'scene_identifier is required' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error object when scene_identifier is only whitespace', async () => {
    const { tools, query } = makeTools();
    const result = await tools.switchScene({ scene_identifier: '   ' });
    expect(result).toMatchObject({ success: false, error: 'scene_identifier is required' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an error object (not a throw) when query throws', async () => {
    const { tools } = makeTools(() => {
      throw new Error('scene not found');
    });
    const result = await tools.switchScene({ scene_identifier: 'Ghost Scene' });
    expect(result).toMatchObject({ success: false, error: 'scene not found' });
  });
});
