import { mkdir, appendFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import {
  resolveLabel,
  safeSegment,
  sessionFolderName,
  trackFilename,
  trackKind,
  trackSource,
} from './naming.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Turns LiveKit webhook events into track egress requests and a per-session log.
 *
 * Dependencies are injected so the logic can be tested without a server:
 *   egress: { startTrackEgress(room, { filepath }, trackSid) -> Promise<egressInfo> }
 *   fs:     { mkdir, appendFile, writeFile } (node:fs/promises compatible)
 */
export function createHandler({
  config,
  egress,
  labels = {},
  fs = { mkdir, appendFile, writeFile, chmod },
  now = () => new Date(),
  sleep = defaultSleep,
  log = console,
}) {
  /** room name -> { folder, dirOnDisk, dirForEgress, startedAt, participants, egresses } */
  const sessions = new Map();
  const startedTracks = new Set();

  async function journal(session, entry) {
    const line = JSON.stringify({ serverTime: now().toISOString(), ...entry });
    await fs.appendFile(path.posix.join(session.dirOnDisk, 'session.jsonl'), `${line}\n`);
  }

  async function ensureSession(roomName) {
    let session = sessions.get(roomName);
    if (session) return session;
    const started = now();
    const folder = sessionFolderName(started, config.timeZone);
    const room = safeSegment(roomName, 'room');
    session = {
      room: roomName,
      folder,
      dirOnDisk: path.posix.join(config.outDir, room, folder),
      dirForEgress: path.posix.join(config.egressOutDir, room, folder),
      startedAt: started.toISOString(),
      participants: {},
      egresses: [],
    };
    sessions.set(roomName, session);
    await fs.mkdir(session.dirOnDisk, { recursive: true, mode: 0o777 });
    // The egress container runs as another user and must be able to write here. mkdir's mode is
    // cut by the umask, so set it explicitly on the room and session folders.
    await fs.chmod(path.posix.dirname(session.dirOnDisk), 0o777);
    await fs.chmod(session.dirOnDisk, 0o777);
    await journal(session, { type: 'session_started', room: roomName });
    return session;
  }

  function shouldRecord(kind, source) {
    if (kind === 'audio') {
      if (source === 'screen_share_audio') return config.recordScreenShare && config.recordAudio;
      return config.recordAudio;
    }
    if (kind === 'video') {
      if (source === 'screen_share') return config.recordScreenShare;
      return config.recordVideo;
    }
    return false;
  }

  async function startWithRetry(roomName, filepath, trackSid) {
    const attempts = Math.max(1, config.startRetries ?? 3);
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await egress.startTrackEgress(roomName, { filepath }, trackSid);
      } catch (err) {
        lastError = err;
        if (attempt < attempts) await sleep(1000 * attempt);
      }
    }
    throw lastError;
  }

  async function onTrackPublished(event) {
    const track = event.track;
    const participant = event.participant;
    const roomName = event.room?.name;
    if (!track?.sid || !participant?.identity || !roomName) return { action: 'ignored' };

    const kind = trackKind(track.type);
    const source = trackSource(track.source);
    const session = await ensureSession(roomName);
    const label = resolveLabel(labels, participant.identity, participant.name);
    session.participants[participant.identity] = { label, name: participant.name ?? null };

    if (!shouldRecord(kind, source)) {
      await journal(session, {
        type: 'track_skipped',
        trackSid: track.sid,
        kind,
        source,
        participantIdentity: participant.identity,
      });
      return { action: 'skipped' };
    }
    if (startedTracks.has(track.sid)) return { action: 'duplicate' };
    startedTracks.add(track.sid);

    const name = trackFilename({
      identity: participant.identity,
      source,
      trackSid: track.sid,
      kind,
      mimeType: track.mimeType,
    });
    const filepath = path.posix.join(session.dirForEgress, name);
    const base = {
      room: roomName,
      participantIdentity: participant.identity,
      participantName: participant.name ?? null,
      label,
      trackSid: track.sid,
      kind,
      source,
      mimeType: track.mimeType ?? null,
      file: name,
      webhookCreatedAt: event.createdAt != null ? Number(event.createdAt) : null,
    };
    try {
      const info = await startWithRetry(roomName, filepath, track.sid);
      const entry = {
        ...base,
        egressId: info?.egressId ?? null,
        egressStatus: info?.status ?? null,
        egressStartedAtNs: info?.startedAt != null ? String(info.startedAt) : null,
      };
      session.egresses.push(entry);
      await journal(session, { type: 'egress_started', ...entry });
      return { action: 'started', filepath, info };
    } catch (err) {
      startedTracks.delete(track.sid);
      log.error?.(`egress start failed for ${track.sid}: ${err.message}`);
      await journal(session, { type: 'egress_failed', ...base, error: String(err.message ?? err) });
      return { action: 'failed', error: err };
    }
  }

  async function onRoomFinished(event) {
    const roomName = event.room?.name;
    const session = roomName ? sessions.get(roomName) : undefined;
    if (!session) return { action: 'ignored' };
    await journal(session, { type: 'room_finished', room: roomName });
    const done = {
      room: roomName,
      folder: session.folder,
      startedAt: session.startedAt,
      finishedAt: now().toISOString(),
      participants: session.participants,
      tracks: session.egresses,
    };
    await fs.writeFile(
      path.posix.join(session.dirOnDisk, 'done.json'),
      `${JSON.stringify(done, null, 2)}\n`,
    );
    sessions.delete(roomName);
    for (const e of session.egresses) startedTracks.delete(e.trackSid);
    return { action: 'done' };
  }

  /** Records how an egress ended (file size, duration, error) so failures are visible. */
  async function onEgressEnded(event) {
    const info = event.egressInfo;
    const roomName = info?.roomName ?? event.room?.name;
    const session = roomName ? sessions.get(roomName) : undefined;
    if (!session) return { action: 'ignored' };
    const failed = Boolean(info?.error);
    if (failed) log.error?.(`egress ${info.egressId} ended with an error: ${info.error}`);
    const files = (info?.fileResults ?? []).map((f) => ({
      filename: f.filename ?? null,
      size: f.size != null ? Number(f.size) : null,
      durationNs: f.duration != null ? String(f.duration) : null,
      startedAtNs: f.startedAt != null ? String(f.startedAt) : null,
      endedAtNs: f.endedAt != null ? String(f.endedAt) : null,
    }));
    await journal(session, {
      type: 'egress_ended',
      egressId: info?.egressId ?? null,
      status: info?.status ?? null,
      error: info?.error || null,
      files,
    });
    return { action: failed ? 'egress_error' : 'egress_ended' };
  }

  /** Logs events that help later alignment. */
  async function onInfoEvent(event, type) {
    const roomName = event.room?.name;
    if (!roomName) return { action: 'ignored' };
    // Egress jobs join the room as participants (identity EG_...); they are not players.
    if (String(event.participant?.identity ?? '').startsWith('EG_')) return { action: 'ignored' };
    const session = await ensureSession(roomName);
    await journal(session, {
      type,
      participantIdentity: event.participant?.identity ?? null,
      trackSid: event.track?.sid ?? null,
    });
    return { action: 'logged' };
  }

  async function handleEvent(event) {
    switch (event?.event) {
      case 'track_published':
        return onTrackPublished(event);
      case 'room_finished':
        return onRoomFinished(event);
      case 'room_started':
        if (event.room?.name) await ensureSession(event.room.name);
        return { action: 'session_opened' };
      case 'egress_ended':
        return onEgressEnded(event);
      case 'participant_joined':
        return onInfoEvent(event, 'participant_joined');
      case 'participant_left':
        return onInfoEvent(event, 'participant_left');
      case 'track_unpublished':
        return onInfoEvent(event, 'track_unpublished');
      default:
        return { action: 'ignored' };
    }
  }

  return { handleEvent, sessions };
}
