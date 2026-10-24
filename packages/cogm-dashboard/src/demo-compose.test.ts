/**
 * The video compose command (`scripts/demo/compose.mjs`): the pure timing and filter-graph
 * builders, the manifest reader, and one end-to-end draft run on a generated test pattern and tone
 * (synthetic, nothing from a real take). The run is skipped where ffmpeg or Windows fonts are missing.
 */
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const demo = (f: string): string => pathToFileURL(path.join(repoRoot, 'scripts', 'demo', f)).href;

const plan = await import(demo('lib/compose-plan.mjs'));
const compose = await import(demo('compose.mjs'));
const captions = await import(demo('lib/captions.mjs'));

const sentence = (
  index: number,
  start: number,
  end: number,
  heading: string | null
): Record<string, unknown> => ({
  index,
  start,
  end,
  shown: `Line ${index}.`,
  spoken: `Line ${index}.`,
  heading,
});

describe('compose: narration to steps', () => {
  const steps = [
    { step: 'open', title: 'Open the tool' },
    { step: 'ready', title: 'Turn on for tonight' },
    { step: 'quiet', title: 'Nothing said here' },
  ];
  const sentences = [
    sentence(1, 0.5, 2.0, 'open'),
    sentence(2, 2.4, 4.0, 'open'),
    sentence(3, 4.4, 6.0, 'Turn on for tonight'),
    sentence(4, 6.4, 7.0, 'Left over'),
  ];

  it('matches a heading to the step name or title and spans first start to last end', () => {
    const { byStep, unmatchedHeadings } = plan.mapNarration(steps, sentences);
    expect(byStep.open).toMatchObject({ from: 0.5, to: 4.0 });
    expect(byStep.ready).toMatchObject({ from: 4.4, to: 6.0 });
    expect(byStep.quiet).toBeUndefined();
    expect(unmatchedHeadings).toEqual(['Left over']);
  });

  it('lets a manifest override pick sentences by index', () => {
    const { byStep, unmatchedHeadings } = plan.mapNarration(steps, sentences, { quiet: [4, 4] });
    expect(byStep.quiet).toMatchObject({ from: 6.4, to: 7.0 });
    expect(unmatchedHeadings).toEqual([]);
  });
});

describe('compose: step timing', () => {
  const st = { step: 'a', start: 10, end: 20 };
  const next = { step: 'b', start: 20, end: 30 };

  it('plays a step as it is when it has no narration', () => {
    const p = plan.planStep({ st, index: 1, next, rawFrames: 3600 });
    expect(p.mode).toBe('plain');
    expect(p.outFrames).toBe(10 * plan.FPS);
    expect(p.hold).toBe(0);
  });

  it('cuts dead time with a ramped fast part so the step ends with its narration', () => {
    const p = plan.planStep({ st, index: 1, next, narrationS: 3, rawFrames: 3600 });
    expect(p.mode).toBe('fast');
    expect(p.segs.map((s: { speed: number }) => s.speed)).toEqual([1, 2, plan.SPEEDUP, 2, 1]);
    expect(p.outLen).toBeCloseTo(3 + plan.BREATH, 1);
    expect(p.hold).toBe(0);
  });

  it('slows a short step down, then holds (with a zoom drift, never a frozen frame)', () => {
    const p = plan.planStep({
      st,
      index: 1,
      next: { step: 'b', start: 12, end: 13 },
      narrationS: 6,
      rawFrames: 3600,
    });
    expect(p.mode).toBe('slow');
    expect(p.segs[0].speed).toBeCloseTo(1 / plan.MAX_SLOW, 5);
    expect(p.hold).toBeGreaterThan(0.6);
    expect(p.outLen).toBeCloseTo(6 + plan.BREATH, 1);
    expect(plan.zoomExpr(p)).toContain('cos(2*PI');
  });

  it('keeps every frame count whole and maps raw times into the step', () => {
    const p = plan.planStep({ st, index: 1, next, narrationS: 3, rawFrames: 3600 });
    expect(Number.isInteger(p.outFrames)).toBe(true);
    expect(p.rawToOut(10)).toBe(0);
    expect(p.rawToOut(19.99)).toBeLessThanOrEqual(p.outLen);
    expect(plan.setptsExpr(p)).toContain('if(lt(N,');
  });

  it('eases a focus zoom between 1.3x and 1.6x around the box centre', () => {
    const focus = { x: 0.2, y: 0.4, w: 0.2, h: 0.1, at: 12 };
    const p = plan.planStep({ st: { ...st, focus }, index: 1, next, rawFrames: 3600 });
    expect(plan.zoomExpr(p)).toContain('0.4*');
    const c = plan.zoomCenter(p);
    expect(c.cx).toBeCloseTo(0.3, 6);
    expect(c.cy).toBeCloseTo(0.45, 6);
    expect(plan.focusZoom({ x: 0, y: 0, w: 0.9, h: 0.9 })).toBe(plan.ZOOM_MIN);
    expect(plan.focusZoom({ x: 0, y: 0, w: 0.1, h: 0.1, zoom: 9 })).toBe(plan.ZOOM_MAX);
  });
});

describe('compose: filter graphs', () => {
  const steps = [
    { step: 'a', start: 1, end: 5, focus: { x: 0.1, y: 0.1, w: 0.2, h: 0.1, at: 3 } },
    { step: 'b', start: 5, end: 9 },
  ];
  const plans = steps.map((st, i) =>
    plan.planStep({ st, index: i, next: steps[i + 1] ?? null, narrationS: 2, rawFrames: 600 })
  );

  it('cuts every step by exact frame numbers, joins them and fades out of the card', () => {
    const { graph, bodyFrames, offset } = plan.chapterGraph({
      plans,
      steps,
      glitches: [[10, 12]],
      card: 'color=c=black[card]',
      W: 2560,
      H: 1440,
    });
    expect(graph).toContain('split=2[s0][s1]');
    expect(graph).toContain(`trim=start_frame=${plans[0].fromF}:end_frame=${plans[0].toF}`);
    expect(graph).toContain("select='not(between(n,10,12))'");
    expect(graph).toContain('concat=n=2:v=1:a=0');
    expect(graph).toContain(
      `xfade=transition=fade:duration=${plan.XFADE}:offset=${plan.CARD - plan.XFADE}`
    );
    expect(graph).toContain('scale=5120:2880'); // the 2x upscale before the zoom
    expect(bodyFrames).toBe(plans[0].outFrames + plans[1].outFrames);
    expect(offset).toBe(plan.CARD - plan.XFADE);
  });

  it('draws the cursor dot and click ring before the zoom only when asked', () => {
    const on = plan.chapterGraph({
      plans,
      steps,
      card: 'c[card]',
      W: 960,
      H: 540,
      draft: true,
      cursor: true,
    }).graph;
    const off = plan.chapterGraph({
      plans,
      steps,
      card: 'c[card]',
      W: 960,
      H: 540,
      draft: true,
    }).graph;
    expect(on).toContain('v0_ring');
    expect(on).toContain('geq=');
    expect(on).toContain(`setpts=PTS+${plans[0].rawToOut(3)}/TB`);
    expect(off).not.toContain('v0_ring');
  });

  it('lays chapters on one clock: each starts an xfade before the previous ends', () => {
    const tl = plan.timeline([
      { frames: 600, steps: [{ len: 4 }, { len: 4.5 }] },
      { frames: 300, steps: [{ len: 3.6 }] },
    ]);
    expect(tl.starts[0]).toBe(0);
    expect(tl.starts[1]).toBeCloseTo(10 - plan.XFADE, 5);
    expect(tl.total).toBeCloseTo(10 - plan.XFADE + 5, 5);
    expect(tl.stepInfo[0][1].start).toBeCloseTo(plan.CARD - plan.XFADE + 4, 5);
    expect(tl.stepInfo[0][0].voiceAt).toBeCloseTo(plan.CARD - plan.XFADE + plan.LEAD_IN, 5);
    const { graph, total } = plan.assembleGraph([600, 300]);
    expect(graph).toContain(`offset=${(10 - plan.XFADE).toFixed(4)}`);
    expect(total).toBeCloseTo(tl.total, 5);
  });

  it('leaves out the title card of a bare chapter and starts its first step at once', () => {
    const { graph, offset } = plan.chapterGraph({
      plans,
      steps,
      card: 'c[card]',
      W: 960,
      H: 540,
      draft: true,
      bare: true,
    });
    expect(graph).toContain('[body]null[out]');
    expect(graph).not.toContain('xfade');
    expect(offset).toBe(0);
    const tl = plan.timeline([{ bare: true, frames: 300, steps: [{ len: 5 }] }]);
    expect(tl.stepInfo[0][0].start).toBe(0);
    expect(tl.stepInfo[0][0].voiceAt).toBeCloseTo(plan.LEAD_IN, 5);
  });

  it('mixes narration at its places, ducks music under it and normalises to -16 LUFS', () => {
    expect(plan.audioGraph({ clips: [], total: 10 })).toBeNull();
    const voice = plan.audioGraph({ clips: [{ input: 3, from: 1, to: 4, at: 2.5 }], total: 10 });
    expect(voice).toContain('[3:a]atrim=start=1:end=4');
    expect(voice).toContain('adelay=2500|2500');
    expect(voice).toContain('loudnorm=I=-16:TP=-1.5');
    expect(voice).toContain('[aout]');
    expect(voice).not.toContain('sidechaincompress');
    const both = plan.audioGraph({
      clips: [
        { input: 3, from: 0, to: 2, at: 1 },
        { input: 4, from: 0, to: 2, at: 6 },
      ],
      music: { input: 5, gainDb: -14 },
      total: 10,
    });
    expect(both).toContain('amix=inputs=2:normalize=0');
    expect(both).toContain('sidechaincompress');
    expect(both).toContain('volume=-14dB');
    expect(plan.audioGraph({ clips: [], music: { input: 5 }, total: 8 })).toContain('[mus]apad');
  });

  it('writes chapter marks that end where the next begins', () => {
    const marks = [
      { at: 0, title: 'One' },
      { at: 65.5, title: 'Two' },
    ];
    expect(plan.chapterMetadata(marks, 100)).toContain('START=65500\nEND=100000\ntitle=Two');
    expect(plan.youtubeChapters(marks)).toBe('0:00 One\n1:05 Two\n');
  });
});

describe('compose: command line and guards', () => {
  it('parses options and rejects mistakes before any encode', () => {
    expect(compose.parseArgs(['m.json', '--cut', 'a,b', '--res', '1080', '--cpu'])).toMatchObject({
      manifest: 'm.json',
      cut: ['a', 'b'],
      res: 1080,
      cpu: true,
    });
    expect(() => compose.parseArgs(['m.json', '--cut=a'])).toThrow(/Unknown option/);
    expect(() => compose.parseArgs(['m.json', '--bogus'])).toThrow(/Unknown option/);
    expect(() => compose.parseArgs(['m.json', '--cut'])).toThrow(/needs a value/);
    expect(() => compose.parseArgs(['m.json', '--res', '720'])).toThrow(/--res/);
    expect(() => compose.parseArgs(['m.json', '--draft-only', '--final-only'])).toThrow(/nothing/);
    expect(() => compose.parseArgs(['a.json', 'b.json'])).toThrow(/more than one/);
    expect(() => compose.parseArgs([])).toThrow(/usage/);
    expect(compose.parseArgs(['m.json', '--draft-only', '--res', '720']).draftOnly).toBe(true);
  });

  it('escapes every colon in a filter path and refuses a single quote', () => {
    expect(compose.esc('C:\\Users\\a b\\f:g.ttf')).toBe('C\\:/Users/a b/f\\:g.ttf');
    expect(() => compose.esc("C:\\Users\\O'Neil")).toThrow(/single quote/);
  });

  it('flags narration for a step that is not one block of sentences', () => {
    const steps = [{ step: 'a' }, { step: 'b' }];
    const s = [sentence(1, 0, 1, 'a'), sentence(2, 1, 2, 'b'), sentence(3, 2, 3, 'a')];
    expect(plan.mapNarration(steps, s).scattered).toEqual(['a']);
  });

  it('uses focus.at, or the step start, for the zoom and the cursor alike', () => {
    const st = { step: 'a', start: 10, end: 20, focus: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } };
    const p = plan.planStep({ st, index: 1, next: null, rawFrames: 3600 });
    expect(p.focusAt).toBe(10);
  });

  it('holds HOLD_AFTER seconds after a click so the result can be seen', () => {
    const quick = {
      step: 'a',
      start: 10,
      end: 12,
      focus: { x: 0.2, y: 0.2, w: 0.1, h: 0.1, at: 11.5 },
    };
    const p = plan.planStep({
      st: quick,
      index: 1,
      next: { step: 'b', start: 12, end: 14 },
      rawFrames: 3600,
    });
    expect(p.outLen - p.rawToOut(11.5)).toBeCloseTo(plan.HOLD_AFTER, 1);
    const roomy = { ...quick, end: 20, focus: { ...quick.focus, at: 11 } };
    const q = plan.planStep({
      st: roomy,
      index: 1,
      next: { step: 'b', start: 20, end: 24 },
      rawFrames: 3600,
    });
    expect(q.hold).toBe(0);
  });

  it('escapes chapter titles for the metadata file', () => {
    expect(plan.escMeta('A=B; C#D\\E\nF')).toBe('A\\=B\\; C\\#D\\\\E F');
  });

  it('writes no cue for an empty sentence and no ASS override from braces', () => {
    expect(captions.cuesFor('', 0, 1)).toEqual([]);
    expect(captions.cuesFor(undefined, 0, 1)).toEqual([]);
    const ass = captions.toAss([{ start: 0, end: 1, lines: ['a {b} c'] }], { W: 960, H: 540 });
    expect(ass).toContain('a (b) c');
  });

  it('keeps cues to two lines of 42 characters inside the sentence time', () => {
    const text = 'word '.repeat(60).trim();
    const cues = captions.cuesFor(text, 5, 15);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42);
      expect(c.start).toBeGreaterThanOrEqual(5);
      expect(c.end).toBeLessThanOrEqual(15.0001);
    }
  });
});

describe('compose: captions and manifest', () => {
  it('writes WebVTT with dots in the times', () => {
    const vtt = captions.toVtt([{ start: 1.5, end: 3, lines: ['Hello'] }]);
    expect(vtt).toBe('WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello\n');
  });

  it('resolves paths from the manifest folder and finds a take folder recording', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-manifest-'));
    try {
      mkdirSync(path.join(dir, 'take-a'));
      writeFileSync(path.join(dir, 'take-a', 'x.mp4'), '');
      writeFileSync(path.join(dir, 'take-a', 'steps.json'), '[]');
      const file = path.join(dir, 'm.json');
      const write = (m: unknown): void => writeFileSync(file, JSON.stringify(m));
      write({
        chapters: [{ id: 1, title: 'A', take: 'take-a', narration: 'voice/a' }],
        cuts: { master: [1] },
        clips: true,
      });
      const m = compose.resolveManifest(file);
      expect(m.chapters[0].video).toBe(path.join(dir, 'take-a', 'x.mp4'));
      expect(m.chapters[0].narration.timing).toBe(path.join(dir, 'voice', 'a.timing.json'));
      expect(m.cuts.map((c: { name: string }) => c.name)).toEqual(['master', 'clip-1']);
      write({ chapters: [{ id: 'a', video: 'v.mp4', steps: 's.json' }], cuts: { x: ['b'] } });
      expect(() => compose.resolveManifest(file)).toThrow(/unknown chapter b/);
      write({
        chapters: [
          { id: 'a', video: 'v.mp4', steps: 's.json' },
          { id: 'a', video: 'v.mp4', steps: 's.json' },
        ],
      });
      expect(() => compose.resolveManifest(file)).toThrow(/unique/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts only chapter ids and cut names of letters, digits, dot, underscore and dash', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-names-'));
    try {
      const file = path.join(dir, 'm.json');
      const write = (m: unknown): void => writeFileSync(file, JSON.stringify(m));
      const chapter = (id: string): object => ({ id, video: 'v.mp4', steps: 's.json' });
      write({ chapters: [chapter('intro 1')] });
      expect(() => compose.resolveManifest(file)).toThrow(/chapter id "intro 1"/);
      write({ chapters: [chapter("a'b")] });
      expect(() => compose.resolveManifest(file)).toThrow(/chapter id/);
      write({ chapters: [chapter('a')], cuts: { 'x/y': ['a'] } });
      expect(() => compose.resolveManifest(file)).toThrow(/cut name "x\/y"/);
      write({ chapters: [chapter('a.b_c-1')], cuts: { 'master-2.0': ['a.b_c-1'] } });
      expect(compose.resolveManifest(file).cuts).toEqual([
        { name: 'master-2.0', ids: ['a.b_c-1'] },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an output folder inside the repo and allows one outside it', () => {
    expect(() => compose.assertOutsideRepo(repoRoot)).toThrow(/inside the repo/);
    expect(() => compose.assertOutsideRepo(path.join(repoRoot, 'docs', 'out'))).toThrow(
      /inside the repo/
    );
    expect(() => compose.assertOutsideRepo(path.join(os.tmpdir(), 'compose-out'))).not.toThrow();
    expect(() => compose.assertOutsideRepo(path.dirname(repoRoot))).not.toThrow();
  });

  it('refuses a take that is not 60 fps, and one whose rate cannot be read', () => {
    expect(() => compose.checkFps('a', '60/1')).not.toThrow();
    expect(() => compose.checkFps('a', '60000/1001')).not.toThrow(); // 59.94 is within half a frame
    expect(() => compose.checkFps('a', '50/1')).toThrow(/50\.00 fps/);
    expect(() => compose.checkFps('a', '30/1')).toThrow(/chapter a: the video is 30\.00 fps/);
    expect(() => compose.checkFps('a', undefined)).toThrow(/fps/);
    expect(() => compose.checkFps('a', '0/0')).toThrow(/fps/);
  });

  it('checks the files of the selected chapters before any encode', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-preflight-'));
    try {
      const at = (f: string): string => path.join(dir, f);
      const chapter = (id: string, extra: object = {}): object => ({
        id,
        video: at(`${id}.mp4`),
        steps: at(`${id}.json`),
        narration: null,
        ...extra,
      });
      const man = (chapters: object[]): object => ({ chapters, music: null });
      const cuts = [{ name: 'master', ids: ['a'] }];
      expect(() => compose.preflight(man([chapter('a')]), cuts)).toThrow(
        /chapter a: missing video/
      );
      writeFileSync(at('a.mp4'), '');
      expect(() => compose.preflight(man([chapter('a')]), cuts)).toThrow(/missing steps file/);
      writeFileSync(at('a.json'), '[]');
      expect(() => compose.preflight(man([chapter('a')]), cuts)).toThrow(/no steps/);
      writeFileSync(at('a.json'), '[{"step":"x"}]');
      const narration = { wav: at('a.wav'), timing: at('a.timing.json') };
      expect(() => compose.preflight(man([chapter('a', { narration })]), cuts)).toThrow(
        /missing narration WAV/
      );
      writeFileSync(at('a.wav'), '');
      expect(() => compose.preflight(man([chapter('a', { narration })]), cuts)).toThrow(
        /missing narration timing\.json/
      );
      // A chapter no selected cut uses is not checked; a missing music file is named.
      const unused = chapter('b');
      expect(() =>
        compose.preflight({ chapters: [unused], music: { file: at('m.mp3') } }, [
          { name: 'x', ids: [] },
        ])
      ).toThrow(/missing music file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('knows the output sizes', () => {
    expect(compose.sizeFor(true, 1440)).toEqual({ W: 960, H: 540 });
    expect(compose.sizeFor(false, 1440)).toEqual({ W: 2560, H: 1440 });
    expect(() => compose.sizeFor(false, 720)).toThrow(/--res/);
  });
});

const ffmpegOk = spawnSync('ffmpeg', ['-version']).status === 0;

describe.skipIf(!ffmpegOk || process.platform !== 'win32')(
  'compose: end to end on a test pattern',
  () => {
    it('builds a draft with the narration mixed in, stills and chapters', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'compose-e2e-'));
      try {
        const ff = (args: string[]): void => {
          const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
            encoding: 'utf8',
          });
          if (r.status !== 0) throw new Error(r.stderr);
        };
        ff([
          '-f',
          'lavfi',
          '-i',
          'testsrc2=s=1280x720:r=60:d=8',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          path.join(dir, 'raw.mp4'),
        ]);
        ff([
          '-f',
          'lavfi',
          '-i',
          'sine=f=220:d=4:r=48000',
          '-ac',
          '1',
          path.join(dir, 'voice.wav'),
        ]);
        writeFileSync(
          path.join(dir, 'steps.json'),
          JSON.stringify([
            { step: 'one', start: 0.5, end: 4, focus: { x: 0.3, y: 0.3, w: 0.2, h: 0.1, at: 2 } },
            { step: 'two', start: 4, end: 8 },
          ])
        );
        const sentences = [
          {
            index: 1,
            start: 0.2,
            end: 2.2,
            shown: 'First step.',
            spoken: 'First step.',
            heading: 'one',
          },
          {
            index: 2,
            start: 2.4,
            end: 3.9,
            shown: 'Second step.',
            spoken: 'Second step.',
            heading: 'two',
          },
        ];
        writeFileSync(path.join(dir, 'voice.timing.json'), JSON.stringify({ sentences }));
        writeFileSync(
          path.join(dir, 'm.json'),
          JSON.stringify({
            brand: 'Test',
            chapters: [
              {
                id: '01',
                title: 'Test chapter',
                video: 'raw.mp4',
                steps: 'steps.json',
                narration: 'voice',
                cursor: true,
              },
            ],
            cuts: { cut: ['01'] },
          })
        );
        const r = spawnSync(
          process.execPath,
          [
            path.join(repoRoot, 'scripts', 'demo', 'compose.mjs'),
            path.join(dir, 'm.json'),
            '--draft-only',
          ],
          { encoding: 'utf8' }
        );
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        const out = path.join(dir, 'compose-out');
        const draft = path.join(out, 'draft', 'cut.draft.mp4');
        expect(existsSync(draft)).toBe(true);
        expect(existsSync(path.join(out, 'stills', '01-one.png'))).toBe(true);
        expect(existsSync(path.join(out, 'stills', '01-two.png'))).toBe(true);
        const probe = spawnSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,width,height,avg_frame_rate',
            '-of',
            'json',
            draft,
          ],
          { encoding: 'utf8' }
        );
        const streams = JSON.parse(probe.stdout).streams as {
          codec_type: string;
          width?: number;
          avg_frame_rate?: string;
        }[];
        const video = streams.find(s => s.codec_type === 'video');
        expect(video).toMatchObject({ width: 960, avg_frame_rate: '60/1' });
        expect(streams.some(s => s.codec_type === 'audio')).toBe(true);
        expect(readFileSync(path.join(out, 'work', 'draft', 'graph-cut.txt'), 'utf8')).toContain(
          'loudnorm'
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  }
);
