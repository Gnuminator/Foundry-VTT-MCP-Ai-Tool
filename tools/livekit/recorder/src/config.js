import { readFileSync } from 'node:fs';

function flag(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

/** Reads the recorder configuration from environment variables. Throws on missing secrets. */
export function loadConfig(env = process.env) {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required (see .env.example).');
  }
  return {
    port: Number(env.RECORDER_PORT ?? 8080),
    livekitHost: env.LIVEKIT_HOST ?? 'http://livekit:7880',
    apiKey,
    apiSecret,
    outDir: env.RECORDER_OUT_DIR ?? '/out',
    // The path egress sees can differ from the path this service sees; both default to /out.
    egressOutDir: env.RECORDER_EGRESS_OUT_DIR ?? env.RECORDER_OUT_DIR ?? '/out',
    timeZone: env.RECORDER_TIMEZONE || env.TZ || undefined,
    recordAudio: flag(env.RECORD_AUDIO, true),
    recordVideo: flag(env.RECORD_VIDEO, false),
    recordScreenShare: flag(env.RECORD_SCREEN_SHARE, false),
    labelsFile: env.RECORDER_LABELS_FILE || undefined,
    startRetries: Number(env.RECORDER_START_RETRIES ?? 3),
  };
}

/** Loads the optional identity-to-label JSON file. A missing or bad file gives an empty map. */
export function loadLabels(file, log = console) {
  if (!file) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    log.warn?.(`labels file ${file} is not a JSON object, ignoring it`);
  } catch (err) {
    log.warn?.(`could not read labels file ${file}: ${err.message}`);
  }
  return {};
}
