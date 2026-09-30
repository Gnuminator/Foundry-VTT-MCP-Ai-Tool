// Pure helpers: enum normalisation, folder and file names, label mapping.

const TRACK_TYPES = { 0: 'audio', 1: 'video', 2: 'data', AUDIO: 'audio', VIDEO: 'video', DATA: 'data' };
const TRACK_SOURCES = {
  0: 'unknown',
  1: 'camera',
  2: 'microphone',
  3: 'screen_share',
  4: 'screen_share_audio',
  UNKNOWN: 'unknown',
  CAMERA: 'camera',
  MICROPHONE: 'microphone',
  SCREEN_SHARE: 'screen_share',
  SCREEN_SHARE_AUDIO: 'screen_share_audio',
};

/** 'audio' | 'video' | 'data' from a protobuf enum (number or name). */
export function trackKind(type) {
  return TRACK_TYPES[type] ?? 'unknown';
}

/** 'microphone' | 'camera' | 'screen_share' | 'screen_share_audio' | 'unknown'. */
export function trackSource(source) {
  return TRACK_SOURCES[source] ?? 'unknown';
}

/** Makes a string safe as one path segment on Windows and Linux. */
export function safeSegment(value, fallback = 'unknown') {
  const cleaned = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/** File extension for a recorded track: Opus audio is Ogg, VP8/VP9/AV1 is WebM, H264 is MP4. */
export function trackExtension(kind, mimeType = '') {
  if (kind === 'audio') return 'ogg';
  const mime = String(mimeType).toLowerCase();
  if (mime.includes('h264') || mime.includes('h265') || mime.includes('hevc')) return 'mp4';
  return 'webm';
}

/** `yyyy-mm-dd_HHMM` in the given IANA time zone (default: the process time zone). */
export function sessionFolderName(date, timeZone) {
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  if (timeZone) options.timeZone = timeZone;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', options).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}`;
}

/** `<participantIdentity>__<source>__<trackSid>.<ext>` */
export function trackFilename({ identity, source, trackSid, kind, mimeType }) {
  return `${safeSegment(identity)}__${safeSegment(source)}__${safeSegment(trackSid)}.${trackExtension(kind, mimeType)}`;
}

/** Player label for a participant: map by identity, then by display name, else the display name or identity. */
export function resolveLabel(labels, identity, name) {
  if (labels && typeof labels === 'object') {
    if (typeof labels[identity] === 'string' && labels[identity]) return labels[identity];
    if (name && typeof labels[name] === 'string' && labels[name]) return labels[name];
  }
  return name || identity;
}
