/**
 * Map-generation orchestration — extracted verbatim from backend.ts (the in-file
 * ComfyUI map pipeline). These handlers are fully dependency-injected (jobQueue /
 * comfyuiClient / logger / foundryClient are passed in), so — unlike the rest of
 * backend.ts — they import cleanly and are unit-testable without binding the
 * control channel or acquiring the process lock.
 *
 *   - handleGenerateMapRequest    — validate + enqueue a job, kick off the background run
 *   - handleCheckMapStatusRequest — look up a job's progress
 *   - handleCancelMapJobRequest   — cancel in ComfyUI + the queue
 *   - processMapGenerationInBackend (internal) — the long-running pipeline
 *
 * Behaviour is unchanged from the original backend.ts implementation.
 */
import type { Logger } from './logger.js';

export async function handleGenerateMapRequest(
  message: any,
  jobQueue: any,
  comfyuiClient: any,
  logger: Logger,
  foundryClient: any
): Promise<any> {
  try {
    logger.info('Map generation request received via WebSocket', { message });

    if (!jobQueue || !comfyuiClient) {
      throw new Error('Map generation components not initialized');
    }

    // Extract data from message - could be in message.data or message directly
    const data = message.data || message;

    // Validate input
    if (!data.prompt || typeof data.prompt !== 'string') {
      throw new Error('Prompt is required and must be a string');
    }

    if (!data.scene_name || typeof data.scene_name !== 'string') {
      throw new Error('Scene name is required and must be a string');
    }

    const params = {
      prompt: data.prompt.trim(),
      scene_name: data.scene_name.trim(),
      size: data.size || 'medium',
      grid_size: data.grid_size || 70,
      quality: data.quality || 'low',
    };

    // Create job using mapgen's JobQueue
    const job = await jobQueue.createJob({ params });
    const jobId = job.id;

    // Start background processing (mapgen style)
    processMapGenerationInBackend(jobId, jobQueue, comfyuiClient, logger, foundryClient).catch(
      error => {
        logger.error('Background map generation failed', { jobId, error });
      }
    );

    return {
      status: 'success',
      jobId,
      message: 'Map generation started',
      estimatedTime: 'varies by hardware and quality setting',
    };
  } catch (error: any) {
    logger.error('Map generation request failed', { error: error.message });
    return {
      status: 'error',
      message: error.message,
    };
  }
}

export async function handleCheckMapStatusRequest(
  data: any,
  jobQueue: any,
  logger: Logger
): Promise<any> {
  try {
    if (!data) {
      throw new Error('Request data is required');
    }
    const jobId = data.job_id;
    if (!jobId) {
      throw new Error('Job ID is required');
    }

    const job = await jobQueue.getJob(jobId);
    if (!job) {
      return {
        status: 'error',
        message: `Job ${jobId} not found`,
      };
    }

    return {
      status: 'success',
      job: {
        id: job.id,
        status: job.status,
        progress_percent: job.progress_percent,
        current_stage: job.current_stage,
        result: job.result,
        error: job.error,
      },
    };
  } catch (error: any) {
    logger.error('Map status check failed', { error: error.message });
    return {
      status: 'error',
      message: error.message,
    };
  }
}

export async function handleCancelMapJobRequest(
  data: any,
  jobQueue: any,
  comfyuiClient: any,
  logger: Logger
): Promise<any> {
  try {
    if (!data) {
      throw new Error('Request data is required');
    }
    const jobId = data.job_id;
    if (!jobId) {
      throw new Error('Job ID is required');
    }

    // Get the job to find ComfyUI prompt_id
    const job = await jobQueue.getJob(jobId);
    if (!job) {
      return {
        status: 'error',
        message: 'Job not found',
      };
    }

    // Cancel in ComfyUI if we have a prompt_id
    if (job.comfyui_job_id) {
      logger.info('Cancelling ComfyUI job', { jobId, promptId: job.comfyui_job_id });
      const comfyuiCancelled = await comfyuiClient.cancelJob(job.comfyui_job_id);
      if (comfyuiCancelled) {
        logger.info('ComfyUI job interrupted successfully', {
          jobId,
          promptId: job.comfyui_job_id,
        });
      } else {
        logger.warn('Failed to interrupt ComfyUI job', { jobId, promptId: job.comfyui_job_id });
      }
    }

    // Mark job as cancelled in our queue
    const cancelled = await jobQueue.cancelJob(jobId);

    return {
      status: cancelled ? 'success' : 'error',
      message: cancelled ? 'Job cancelled successfully' : 'Failed to cancel job',
    };
  } catch (error: any) {
    logger.error('Map job cancellation failed', { error: error.message });
    return {
      status: 'error',
      message: error.message,
    };
  }
}

// Background processing using mapgen's proven approach
async function processMapGenerationInBackend(
  jobId: string,
  jobQueue: any,
  comfyuiClient: any,
  logger: Logger,
  foundryClient: any
): Promise<void> {
  // CRITICAL: Log entry to file IMMEDIATELY
  const fs2 = await import('fs').then(m => m.promises);
  const path2 = await import('path');
  const os2 = await import('os');
  const processDebugLog = path2.join(os2.tmpdir(), 'process-mapgen-debug.log');
  await fs2.appendFile(
    processDebugLog,
    `[${new Date().toISOString()}] processMapGenerationInBackend ENTERED - jobId: ${jobId}\n`
  );

  try {
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Getting job from queue...\n`
    );
    const job = await jobQueue.getJob(jobId);
    if (!job) {
      await fs2.appendFile(
        processDebugLog,
        `[${new Date().toISOString()}] ERROR: Job not found!\n`
      );
      throw new Error(`Job ${jobId} not found`);
    }

    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Job retrieved: ${JSON.stringify(job.params)}\n`
    );
    logger.info('Starting background map generation processing', { jobId, params: job.params });

    // Mark job as started (mapgen style)
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Marking job as started...\n`
    );
    await jobQueue.markJobStarted(jobId);
    await fs2.appendFile(processDebugLog, `[${new Date().toISOString()}] Job marked as started\n`);

    // Emit progress to Foundry module
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Sending initial progress...\n`
    );
    foundryClient.sendMessage({
      type: 'map-generation-progress',
      jobId,
      progress: 10,
      stage: 'Starting processing...',
    });

    // Ensure ComfyUI is running
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Checking ComfyUI health...\n`
    );
    const healthInfo = await comfyuiClient.checkHealth();
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Health check: ${JSON.stringify(healthInfo)}\n`
    );
    if (!healthInfo.available) {
      await comfyuiClient.startService();
    }

    await jobQueue.updateJobProgress(jobId, 25, 'Submitting to ComfyUI...');
    foundryClient.sendMessage({
      type: 'map-generation-progress',
      jobId,
      progress: 25,
      stage: 'Submitting to ComfyUI...',
    });

    // Submit to ComfyUI (using mapgen's client)
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Submitting job to ComfyUI...\n`
    );
    const sizePixels = comfyuiClient.getSizePixels(job.params.size);
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Size pixels: ${sizePixels}\n`
    );

    let comfyuiJob;
    try {
      comfyuiJob = await comfyuiClient.submitJob({
        prompt: job.params.prompt,
        width: sizePixels,
        height: sizePixels,
        quality: job.params.quality,
      });
      await fs2.appendFile(
        processDebugLog,
        `[${new Date().toISOString()}] ComfyUI job submitted: ${comfyuiJob.prompt_id}\n`
      );

      // Store ComfyUI prompt_id in job for cancellation support
      const currentJob = await jobQueue.getJob(jobId);
      if (currentJob) {
        currentJob.comfyui_job_id = comfyuiJob.prompt_id;
      }
    } catch (submitError: any) {
      await fs2.appendFile(
        processDebugLog,
        `[${new Date().toISOString()}] ERROR submitting to ComfyUI: ${submitError.message}\n`
      );
      await fs2.appendFile(
        processDebugLog,
        `[${new Date().toISOString()}] Error stack: ${submitError.stack}\n`
      );
      throw submitError;
    }

    // Wait for completion (mapgen style)
    await jobQueue.updateJobProgress(jobId, 50, 'Generating battlemap...');
    foundryClient.sendMessage({
      type: 'map-generation-progress',
      jobId,
      progress: 50,
      stage: 'Generating battlemap...',
    });

    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Starting status polling with WebSocket progress...\n`
    );

    // Register WebSocket callback for real-time progress updates
    comfyuiClient.registerProgressCallback(
      comfyuiJob.prompt_id,
      (progress: { currentStep: number; totalSteps: number }) => {
        const { currentStep, totalSteps } = progress;
        const progressPercent = Math.floor((currentStep / totalSteps) * 100);

        logger.info('Real-time progress update from ComfyUI', {
          jobId,
          promptId: comfyuiJob.prompt_id,
          currentStep,
          totalSteps,
          progressPercent,
        });

        // Send progress update to Foundry
        foundryClient.sendMessage({
          type: 'map-generation-progress',
          data: {
            jobId,
            progress: 50 + progressPercent / 2, // Map 0-100% to 50-100% (since we're at 50% when generation starts)
            status: 'AI generating battlemap...',
            queueInfo: {
              currentStep,
              totalSteps,
              estimatedTimeRemaining: undefined, // WebSocket doesn't provide time estimates
            },
          },
        });
      }
    );

    let status = await comfyuiClient.getJobStatus(comfyuiJob.prompt_id);
    logger.info('Initial job status', { jobId, promptId: comfyuiJob.prompt_id, status });
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Initial status: ${status}\n`
    );

    let pollCount = 0;
    while (status === 'queued' || status === 'running') {
      pollCount++;
      logger.info('Polling job status', {
        jobId,
        promptId: comfyuiJob.prompt_id,
        pollCount,
        currentStatus: status,
      });

      await new Promise(resolve => setTimeout(resolve, 5000)); // Check status every 5 seconds (WebSocket handles progress)
      status = await comfyuiClient.getJobStatus(comfyuiJob.prompt_id);

      logger.info('Job status after poll', {
        jobId,
        promptId: comfyuiJob.prompt_id,
        pollCount,
        newStatus: status,
      });
    }

    // Unregister callback when done
    comfyuiClient.unregisterProgressCallback(comfyuiJob.prompt_id);

    logger.info('Job polling completed', {
      jobId,
      promptId: comfyuiJob.prompt_id,
      finalStatus: status,
      totalPolls: pollCount,
    });
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Polling complete, status: ${status}\n`
    );

    if (status === 'failed') {
      throw new Error('ComfyUI generation failed');
    }

    // Download and save the generated image (like mapgen does)
    await fs2.appendFile(processDebugLog, `[${new Date().toISOString()}] Getting job images...\n`);
    await jobQueue.updateJobProgress(jobId, 85, 'Downloading image...');

    // Get the generated image filenames from ComfyUI history
    const imageFilenames = await comfyuiClient.getJobImages(comfyuiJob.prompt_id);
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Images: ${JSON.stringify(imageFilenames)}\n`
    );
    if (!imageFilenames || imageFilenames.length === 0) {
      throw new Error('No images found in ComfyUI job output');
    }

    // Download the first generated image
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Downloading image: ${imageFilenames[0]}\n`
    );
    const firstImageFilename = imageFilenames[0];
    const imageBuffer = await comfyuiClient.downloadImage(firstImageFilename);
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Downloaded, buffer size: ${imageBuffer?.length || 0}\n`
    );
    if (!imageBuffer) {
      throw new Error(`Failed to download generated image: ${firstImageFilename}`);
    }

    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Updating progress to 90%...\n`
    );
    await jobQueue.updateJobProgress(jobId, 90, 'Saving image...');
    await fs2.appendFile(processDebugLog, `[${new Date().toISOString()}] Progress updated\n`);

    // Save image to Foundry-accessible location
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] About to import fs/path/os for upload...\n`
    );
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    const os = await import('os');
    await fs2.appendFile(processDebugLog, `[${new Date().toISOString()}] Imports complete\n`);

    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Creating filename and checking connection type...\n`
    );
    const timestamp = Date.now();
    const filename = `map_${jobId}_${timestamp}.png`;

    // ALWAYS upload images via Foundry query instead of direct filesystem write
    // Reason: MCP server and Foundry may be on different machines or have different paths
    // The Foundry module's upload handler knows the correct local path
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] foundryClient exists: ${!!foundryClient}, type: ${typeof foundryClient}\n`
    );
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] About to call getConnectionType()...\n`
    );
    let connectionType: 'websocket' | 'webrtc' | null = null;
    try {
      connectionType = foundryClient.getConnectionType();
      await fs2.appendFile(
        processDebugLog,
        `[${new Date().toISOString()}] getConnectionType() returned: ${connectionType}\n`
      );
    } catch (err) {
      await fs2.appendFile(
        processDebugLog,
        `[${new Date().toISOString()}] getConnectionType() threw error: ${err}\n`
      );
      connectionType = 'webrtc'; // Assume WebRTC since we're here
    }

    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Using upload method for all connections\n`
    );

    // ALWAYS write debug log to trace execution
    const debugLog = async (msg: string) => {
      const logPath = path.join(os.tmpdir(), 'foundry-mcp-upload-debug.log');
      await fs.appendFile(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    };

    await debugLog(`=== MAP GENERATION DEBUG START ===`);
    await debugLog(`JobId: ${jobId}, Filename: ${filename}`);
    await debugLog(`Connection type: ${connectionType}`);
    await debugLog(`Image size: ${imageBuffer.length} bytes`);
    await debugLog(`Using upload method (always) - imageSize: ${imageBuffer.length} bytes`);

    // Convert image buffer to base64 for transmission
    const base64Image = imageBuffer.toString('base64');
    await debugLog(
      `Base64 conversion complete - size: ${base64Image.length} bytes (${(base64Image.length / 1024 / 1024).toFixed(2)} MB)`
    );

    // Upload to Foundry via WebRTC/WebSocket query
    // The Foundry module's upload handler knows the correct local path
    await debugLog('Sending upload query to Foundry...');

    let uploadResult: any;
    try {
      uploadResult = await foundryClient.query('foundry-mcp-bridge.upload-generated-map', {
        filename,
        imageData: base64Image,
      });

      await debugLog(`Upload query completed - success: ${uploadResult.success}`);
      await debugLog(`Full uploadResult: ${JSON.stringify(uploadResult)}`);

      if (!uploadResult.success) {
        await debugLog(`Upload failed - error: ${uploadResult.error}`);
        throw new Error(`Failed to upload image to Foundry: ${uploadResult.error}`);
      }
    } catch (error) {
      await debugLog(`Upload exception: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    await debugLog(`Extracting path from uploadResult...`);
    const webPath = uploadResult.path;
    await debugLog(`webPath extracted: ${webPath}`);
    logger.info('Image uploaded successfully to Foundry', { path: webPath });

    await jobQueue.updateJobProgress(jobId, 95, 'Creating scene data...');

    // Create scene data payload (simplified version of mapgen's FoundryIntegrator)
    const sceneSize = comfyuiClient.getSizePixels(job.params.size);
    // Debug: Log what we received
    logger.info('Job params received', {
      scene_name: job.params.scene_name,
      prompt: job.params.prompt,
      all_params: job.params,
    });

    if (!job.params.scene_name) {
      throw new Error(
        `Scene name missing from job params. Received params: ${JSON.stringify(job.params)}`
      );
    }

    const sceneName = job.params.scene_name.trim();
    logger.info('Using scene name', { scene_name: sceneName });
    const sceneData = {
      name: sceneName,
      img: webPath,
      background: { src: webPath }, // Foundry v13 compatibility
      width: sceneSize,
      height: sceneSize,
      padding: 0.25,
      initial: {
        x: sceneSize / 2,
        y: sceneSize / 2,
        scale: 1,
      },
      backgroundColor: '#999999',
      grid: {
        type: 1, // CONST.GRID_TYPES.SQUARE
        size: job.params.grid_size || 100,
        color: '#000000',
        alpha: 0.2,
        distance: 5,
        units: 'ft',
      },
      tokenVision: true,
      fogExploration: true,
      fogReset: Date.now(),
      globalLight: false,
      darkness: 0,
      navigation: true,
      active: false,
      permission: {
        default: 2, // CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      },
      walls: [], // Could add wall detection here later
    };

    // Mark job as complete with full result data
    await jobQueue.updateJobProgress(jobId, 100, 'Complete');
    await jobQueue.markJobComplete(jobId, {
      generation_time_ms: Date.now() - (job.started_at || job.created_at),
      image_url: webPath,
      foundry_scene_payload: sceneData,
    });

    // Broadcast completion with scene data (like mapgen does)
    foundryClient.broadcastMessage({
      type: 'job-completed', // Use mapgen's message type
      jobId,
      data: {
        status: 'completed',
        result: sceneData, // Complete scene payload
        image_path: webPath,
        prompt: job.params.prompt,
      },
    });

    logger.info('Map generation completed successfully', { jobId });
  } catch (error: any) {
    // Log to debug file first
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] ERROR in processMapGenerationInBackend: ${error.message}\n`
    );
    await fs2.appendFile(
      processDebugLog,
      `[${new Date().toISOString()}] Error stack: ${error.stack}\n`
    );

    logger.error('Background map generation processing failed', { jobId, error });
    await jobQueue.markJobFailed(jobId, error.message);

    // Emit failure to Foundry module
    foundryClient.sendMessage({
      type: 'map-generation-failed',
      jobId,
      error: error.message,
    });
  }
}
