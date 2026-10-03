// Set up OBS for demo takes: the WebSocket server (password from the gitignored
// scripts/demo/local.json), a "Foundry AI Tool demo" profile (60 fps, Hybrid MP4,
// NVENC) and scene collection (one window-capture scene per demo window).
//
// OBS 32.2.2 crashes (libobs-winrt, graphics thread) when its video is reset while a
// window capture has been running, and a video reset over the WebSocket leaves the
// outputs broken ("Starting the output failed") until the profile loads again. So the
// resolution and output settings are never changed in a running OBS: ensureObs closes
// OBS, writes them into the profile's basic.ini, and starts OBS on that profile.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ObsClient } from './obs.mjs';
import { RESOLUTIONS, demoLocal } from './env.mjs';
import { OBS_COLLECTION, OBS_PROFILE, SCENES, windowSpec } from './scenes.mjs';

export const OBS_EXE = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';
const OBS_CONFIG = join(process.env.APPDATA ?? '', 'obs-studio');
const WS_CONFIG = join(OBS_CONFIG, 'plugin_config', 'obs-websocket', 'config.json');
// OBS names a profile's folder after the profile, spaces as underscores.
const PROFILE_INI = join(
  OBS_CONFIG,
  'basic',
  'profiles',
  OBS_PROFILE.replace(/ /g, '_'),
  'basic.ini'
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function obsRunning() {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], {
    encoding: 'utf8',
  });
  return /obs64\.exe/i.test(out);
}

/** Write OBS's WebSocket config (only while OBS is closed; OBS rewrites it on exit). */
function writeWebSocketConfig({ obsPort, obsPassword }) {
  const current = existsSync(WS_CONFIG) ? JSON.parse(readFileSync(WS_CONFIG, 'utf8')) : {};
  const next = {
    ...current,
    alerts_enabled: false,
    auth_required: true,
    first_load: false,
    server_enabled: true,
    server_password: obsPassword,
    server_port: obsPort,
  };
  mkdirSync(dirname(WS_CONFIG), { recursive: true });
  writeFileSync(WS_CONFIG, JSON.stringify(next, null, 4));
}

/** Start OBS detached on the demo profile and scene collection. */
function launchObs({ demo }) {
  if (!existsSync(OBS_EXE))
    throw new Error(`OBS not found at ${OBS_EXE} (winget install OBSProject.OBSStudio).`);
  const args = ['--disable-shutdown-check', '--disable-updater'];
  if (demo) args.push('--profile', OBS_PROFILE, '--collection', OBS_COLLECTION);
  // OBS needs its own folder as working directory.
  spawn(OBS_EXE, args, { cwd: dirname(OBS_EXE), detached: true, stdio: 'ignore' }).unref();
}

/** Ask OBS to close (like clicking X) and wait until it has saved and exited. */
async function closeObs(obs) {
  obs?.close();
  if (!obsRunning()) return;
  try {
    execFileSync('taskkill', ['/IM', 'obs64.exe'], { stdio: 'ignore' });
  } catch {
    // taskkill fails when no window takes the close message; the wait below decides.
  }
  for (let i = 0; i < 40 && obsRunning(); i++) await sleep(500);
  if (obsRunning())
    throw new Error(
      'OBS did not close (a dialog open, or recording?). Close OBS, then run the take again.'
    );
}

/** Connect, retrying while OBS starts. */
async function connectObs({ obsPort, obsPassword }, waitMs = 60000) {
  const deadline = Date.now() + waitMs;
  let last;
  while (Date.now() < deadline) {
    try {
      return await ObsClient.connect({ port: obsPort, password: obsPassword });
    } catch (err) {
      last = err;
      if (/wrong password/.test(String(err))) throw err;
      await sleep(1000);
    }
  }
  // After a crash OBS asks about safe mode before it starts the WebSocket server.
  throw new Error(
    `${last.message}. Is OBS waiting on a dialog (for example safe mode after a crash)?`
  );
}

/** The profile's output and video settings for a resolution, as basic.ini keys. */
function profileSettings(res) {
  const r = RESOLUTIONS[res];
  if (!r) throw new Error(`Unknown resolution ${res}; use 1080, 1440 or 2160.`);
  return {
    Output: { Mode: 'Simple' },
    SimpleOutput: { RecFormat2: 'hybrid_mp4', RecQuality: 'HQ', RecEncoder: 'nvenc' },
    Audio: { SampleRate: '48000' },
    Video: {
      BaseCX: String(r.width),
      BaseCY: String(r.height),
      OutputCX: String(r.width),
      OutputCY: String(r.height),
      FPSType: '2', // fraction
      FPSNum: '60',
      FPSDen: '1',
    },
  };
}

/** Set keys in an ini file, keeping every other line (and a byte order mark) as it was. */
export function editIni(file, settings) {
  let text = readFileSync(file, 'utf8');
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.slice(bom.length).split(/\r?\n/);
  for (const [section, keys] of Object.entries(settings)) {
    let start = lines.findIndex(l => l.trim() === `[${section}]`);
    if (start === -1) {
      if (lines.at(-1) === '') lines.pop();
      lines.push(`[${section}]`, '');
      start = lines.length - 2;
    }
    let end = lines.findIndex((l, i) => i > start && /^\[.*\]$/.test(l.trim()));
    if (end === -1) end = lines.length;
    for (const [key, value] of Object.entries(keys)) {
      const at = lines.findIndex((l, i) => i > start && i < end && l.startsWith(`${key}=`));
      if (at !== -1) lines[at] = `${key}=${value}`;
      else {
        // Insert before the blank lines that close the section.
        let pos = end;
        while (pos - 1 > start && lines[pos - 1] === '') pos--;
        lines.splice(pos, 0, `${key}=${value}`);
        end++;
      }
    }
  }
  writeFileSync(file, bom + lines.join(eol));
}

async function profileMatches(obs, res) {
  const { currentProfileName } = await obs.call('GetProfileList');
  const { currentSceneCollectionName } = await obs.call('GetSceneCollectionList');
  if (currentProfileName !== OBS_PROFILE || currentSceneCollectionName !== OBS_COLLECTION)
    return false;
  const video = await obs.call('GetVideoSettings');
  const r = RESOLUTIONS[res];
  if (video.baseWidth !== r.width || video.baseHeight !== r.height) return false;
  if (video.outputWidth !== r.width || video.outputHeight !== r.height) return false;
  if (video.fpsNumerator / video.fpsDenominator !== 60) return false;
  for (const [cat, keys] of Object.entries(profileSettings(res))) {
    if (cat === 'Video') continue;
    for (const [name, value] of Object.entries(keys)) {
      const p = await obs.call('GetProfileParameter', {
        parameterCategory: cat,
        parameterName: name,
      });
      if ((p.parameterValue ?? p.defaultParameterValue) !== value) return false;
    }
  }
  return true;
}

// Every capture sits at the canvas origin at 1:1 (no rescaling); cropToPage trims it.
const PIXEL_EXACT = {
  positionX: 0,
  positionY: 0,
  alignment: 5, // top left
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  boundsType: 'OBS_BOUNDS_NONE',
};

/** The scenes and their window captures (no video reset involved). */
async function ensureScenes(obs) {
  const sceneNames = new Set((await obs.call('GetSceneList')).scenes.map(s => s.sceneName));
  const inputNames = new Set((await obs.call('GetInputList')).inputs.map(i => i.inputName));
  for (const [sceneName, title] of Object.entries(SCENES)) {
    if (!sceneNames.has(sceneName)) await obs.call('CreateScene', { sceneName });
    const inputName = `${sceneName} window`;
    const inputSettings = {
      method: 2, // Windows 10 (1903 and up) capture: works for covered windows
      window: windowSpec(title),
      priority: 1, // the window title must match
      cursor: false, // the take draws its own cursor
      client_area: true,
      compatibility: false,
      capture_audio: false,
    };
    if (!inputNames.has(inputName)) {
      await obs.call('CreateInput', {
        sceneName,
        inputName,
        inputKind: 'window_capture',
        inputSettings,
      });
    } else {
      await obs.call('SetInputSettings', { inputName, inputSettings, overlay: true });
    }
    const { sceneItemId } = await obs.call('GetSceneItemId', { sceneName, sourceName: inputName });
    await obs.call('SetSceneItemTransform', {
      sceneName,
      sceneItemId,
      sceneItemTransform: PIXEL_EXACT,
    });
  }
  if (sceneNames.has('Scene')) {
    await obs.call('SetCurrentProgramScene', { sceneName: 'Dashboard' });
    await obs.call('RemoveScene', { sceneName: 'Scene' });
  }
  // Takes are silent (a voiceover is added later); keep desktop sounds and the mic out.
  const special = await obs.call('GetSpecialInputs');
  for (const name of Object.values(special)) {
    if (name) await obs.call('SetInputMute', { inputName: name, inputMuted: true });
  }
}

/** First run: create the demo profile and scene collection in a fresh OBS. */
async function bootstrap(local) {
  if (obsRunning()) await closeObs();
  writeWebSocketConfig(local);
  launchObs({ demo: false });
  const obs = await connectObs(local);
  const { profiles } = await obs.call('GetProfileList');
  if (!profiles.includes(OBS_PROFILE))
    await obs.call('CreateProfile', { profileName: OBS_PROFILE });
  const { sceneCollections } = await obs.call('GetSceneCollectionList');
  if (!sceneCollections.includes(OBS_COLLECTION)) {
    await obs.call('CreateSceneCollection', { sceneCollectionName: OBS_COLLECTION });
  }
  await closeObs(obs);
  if (!existsSync(PROFILE_INI)) throw new Error(`OBS did not create ${PROFILE_INI}.`);
}

/**
 * A connected OBS on the demo profile and scenes at a resolution, recording into
 * recordDir. Reuses a running OBS when it already matches; otherwise restarts it.
 */
export async function ensureObs({ res, recordDir }) {
  const local = demoLocal({ create: true });
  if (!existsSync(PROFILE_INI)) await bootstrap(local);
  let obs = null;
  if (obsRunning()) {
    obs = await connectObs(local, 5000).catch(() => null);
    if (obs && !(await profileMatches(obs, res))) {
      await closeObs(obs);
      obs = null;
    } else if (!obs) {
      await closeObs();
    }
  }
  if (!obs) {
    editIni(PROFILE_INI, profileSettings(res));
    writeWebSocketConfig(local);
    launchObs({ demo: true });
    obs = await connectObs(local);
    if (!(await profileMatches(obs, res))) {
      throw new Error(`OBS started without the demo settings; check ${PROFILE_INI}.`);
    }
  }
  await ensureScenes(obs);
  if (recordDir) {
    mkdirSync(recordDir, { recursive: true });
    await obs.call('SetRecordDirectory', { recordDirectory: recordDir });
  }
  return obs;
}

/**
 * Crop a scene's window capture to the page in the window's top-left corner (the
 * fullscreen layout of openWindow), once OBS has found the window. Puts the scene on air
 * (call it before recording starts).
 */
export async function cropToPage(obs, sceneName, res, timeoutMs = 10000, size = RESOLUTIONS[res]) {
  // The page's size in device pixels: the whole canvas, or less (a phone-sized page sits
  // in the top-left corner of the recording and is cut out in the edit).
  const r = size;
  // A window capture only runs (and has a size) while its scene is on air.
  await obs.call('SetCurrentProgramScene', { sceneName });
  const { sceneItemId } = await obs.call('GetSceneItemId', {
    sceneName,
    sourceName: `${sceneName} window`,
  });
  const deadline = Date.now() + timeoutMs;
  let t;
  for (;;) {
    t = (await obs.call('GetSceneItemTransform', { sceneName, sceneItemId })).sceneItemTransform;
    if (t.sourceWidth >= r.width && t.sourceHeight >= r.height) break;
    if (Date.now() > deadline) {
      throw new Error(
        `OBS scene "${sceneName}": the window capture is ${t.sourceWidth}x${t.sourceHeight}, smaller than ${r.width}x${r.height} (window not found, or not fullscreen?).`
      );
    }
    await sleep(250);
  }
  await obs.call('SetSceneItemTransform', {
    sceneName,
    sceneItemId,
    sceneItemTransform: {
      ...PIXEL_EXACT,
      cropLeft: 0,
      cropTop: 0,
      cropRight: t.sourceWidth - r.width,
      cropBottom: t.sourceHeight - r.height,
    },
  });
}
