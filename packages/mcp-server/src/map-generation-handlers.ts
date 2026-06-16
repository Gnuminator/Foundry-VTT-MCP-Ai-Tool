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
  try {
    const job = await jobQueue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    logger.info('Starting background map generation processing', { jobId, params: job.params });

    // Mark job as started (mapgen style)
    await jobQueue.markJobStarted(jobId);

    // Emit progress to Foundry module
    foundryClient.sendMessage({
      type: 'map-generation-progress',
      jobId,
      progress: 10,
      stage: 'Starting processing...',
    });

    // Ensure ComfyUI is running
    const healthInfo = await comfyuiClient.checkHealth();
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
    const sizePixels = comfyuiClient.getSizePixels(job.params.size);
    const comfyuiJob = await comfyuiClient.submitJob({
      prompt: job.params.prompt,
      width: sizePixels,
      height: sizePixels,
      quality: job.params.quality,
    });

    // Store ComfyUI prompt_id in job for cancellation support
    const currentJob = await jobQueue.getJob(jobId);
    if (currentJob) {
      currentJob.comfyui_job_id = comfyuiJob.prompt_id;
    }

    // Wait for completion (mapgen style)
    await jobQueue.updateJobProgress(jobId, 50, 'Generating battlemap...');
    foundryClient.sendMessage({
      type: 'map-generation-progress',
      jobId,
      progress: 50,
      stage: 'Generating battlemap...',
    });

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

    if (status === 'failed') {
      throw new Error('ComfyUI generation failed');
    }

    // Download and save the generated image (like mapgen does)
    await jobQueue.updateJobProgress(jobId, 85, 'Downloading image...');

    // Get the generated image filenames from ComfyUI history
    const imageFilenames = await comfyuiClient.getJobImages(comfyuiJob.prompt_id);
    if (!imageFilenames || imageFilenames.length === 0) {
      throw new Error('No images found in ComfyUI job output');
    }

    // Download the first generated image
    const firstImageFilename = imageFilenames[0];
    const imageBuffer = await comfyuiClient.downloadImage(firstImageFilename);
    if (!imageBuffer) {
      throw new Error(`Failed to download generated image: ${firstImageFilename}`);
    }

    await jobQueue.updateJobProgress(jobId, 90, 'Saving image...');

    const timestamp = Date.now();
    const filename = `map_${jobId}_${timestamp}.png`;

    // ALWAYS upload images via Foundry query instead of direct filesystem write.
    // Reason: MCP server and Foundry may be on different machines or have different
    // paths; the Foundry module's upload handler knows the correct local path.
    logger.info('Uploading generated map to Foundry', {
      jobId,
      filename,
      imageBytes: imageBuffer.length,
    });

    // Convert image buffer to base64 for transmission
    const base64Image = imageBuffer.toString('base64');

    const uploadResult: any = await foundryClient.query('foundry-mcp-bridge.upload-generated-map', {
      filename,
      imageData: base64Image,
    });
    if (!uploadResult.success) {
      throw new Error(`Failed to upload image to Foundry: ${uploadResult.error}`);
    }

    const webPath = uploadResult.path;
    logger.info('Image uploaded successfully to Foundry', { path: webPath });

    await jobQueue.updateJobProgress(jobId, 95, 'Creating scene data...');

    // Create scene data payload (simplified version of mapgen's FoundryIntegrator)
    const sceneSize = comfyuiClient.getSizePixels(job.params.size);

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
