/**
 * Handout press (I-184): three HTML templates (letter, notice, card) and a local render of one to
 * a PNG with a headless Edge, Chrome or Chromium already on the computer the backend runs on. No image AI, no network, no
 * downloaded fonts or textures: the paper is CSS gradients and system serif fonts.
 *
 * The supplied text is escaped here, so it can never add markup to the page.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { HandoutPressTemplate } from '@gnuminator/shared';

export interface PressContent {
  /** The heading: a salutation, a notice headline or the card name. */
  title: string;
  /** The text; a blank line starts a new paragraph. */
  body: string;
  /** Under the text: a signature, a place or a card caption. */
  footer?: string;
}

/**
 * What fits on each page. The page also shrinks its text to fit (see FIT_SCRIPT), so these are
 * the lengths that still read well at the smallest size, not the lengths at full size.
 */
export const PRESS_LIMITS = {
  title: { letter: 120, notice: 60, card: 30 },
  footer: 120,
  body: { letter: 1200, notice: 700, card: 400 },
} as const;

/**
 * Shrinks the heading, the text and their spacing together in steps until the page holds it (down
 * to 55%); the page is our own markup. If it still does not fit, body.dataset.overflow is "1".
 */
const FIT_SCRIPT = `(function(){var s=document.querySelector('.sheet');
var els=[].slice.call(s.querySelectorAll('h1,p,.foot,.art'));
var P=['fontSize','marginTop','marginBottom','height'];
var base=els.map(function(e){var c=getComputedStyle(e);
return P.map(function(n){return n==='height'&&!e.classList.contains('art')?0:parseFloat(c[n])||0;});});
var k=1;
while(s.scrollHeight>s.clientHeight+1&&k>0.55){k-=0.05;
els.forEach(function(e,i){var b=base[i];if(b[0])e.style.fontSize=(b[0]*k)+'px';
e.style.marginTop=(b[1]*k)+'px';e.style.marginBottom=(b[2]*k)+'px';
if(b[3])e.style.height=(b[3]*k)+'px';});}
if(s.scrollHeight>s.clientHeight+1||s.scrollWidth>s.clientWidth+1)document.body.dataset.overflow='1';})();`;

interface Size {
  width: number;
  height: number;
}

/** The picture size (CSS pixels; the render doubles it for a crisp image). */
export const PRESS_SIZES: Record<HandoutPressTemplate, Size> = {
  letter: { width: 720, height: 960 },
  notice: { width: 720, height: 960 },
  card: { width: 480, height: 760 },
};

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphs(body: string): string {
  return body
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

const SERIF = "Georgia, 'Palatino Linotype', 'Book Antiqua', 'Times New Roman', serif";

const LETTER_CSS = `
  body { background: radial-gradient(ellipse at center, #3a2d22 0%, #1d1611 100%); }
  .sheet { position: absolute; inset: 36px; padding: 70px 76px 150px; color: #3b2a1a;
    background: radial-gradient(ellipse at 30% 20%, #f3e4bf 0%, #e6d09f 55%, #d2b87f 100%);
    box-shadow: 0 8px 30px rgba(0,0,0,.6), inset 0 0 90px rgba(120,80,30,.45);
    border-radius: 3px; overflow: hidden; }
  h1 { font-size: 34px; font-style: italic; font-weight: normal; margin: 0 0 30px; }
  p { font-size: 25px; line-height: 1.5; margin: 0 0 18px; }
  .foot { margin-top: 24px; font-size: 30px; font-style: italic; text-align: right; }
  .seal { position: absolute; right: 70px; bottom: 50px; width: 74px; height: 74px;
    border-radius: 50%; background: radial-gradient(circle at 35% 30%, #b3262b, #6c1015 70%);
    box-shadow: 0 2px 5px rgba(0,0,0,.5), inset 0 0 8px rgba(0,0,0,.5); }
  .seal::after { content: ''; position: absolute; inset: 16px; border-radius: 50%;
    border: 2px solid rgba(255,220,200,.35); }
`;

const NOTICE_CSS = `
  body { background: #2a2622; }
  .sheet { position: absolute; inset: 30px; padding: 50px 60px; color: #231a12; text-align: center;
    background: linear-gradient(170deg, #e9dcc0 0%, #d9c7a0 100%);
    box-shadow: 0 6px 26px rgba(0,0,0,.6), inset 0 0 70px rgba(90,60,20,.35); overflow: hidden; }
  .sheet::before { content: ''; position: absolute; inset: 16px; border: 5px double #5b3d20; }
  h1 { font-size: 62px; letter-spacing: 3px; text-transform: uppercase; margin: 40px 0 26px;
    line-height: 1.05; }
  hr { border: 0; border-top: 3px solid #5b3d20; width: 60%; margin: 0 auto 30px; }
  p { font-size: 27px; line-height: 1.45; margin: 0 0 20px; }
  .foot { margin-top: 28px; font-size: 28px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; }
`;

const CARD_CSS = `
  body { background: #120f16; }
  .sheet { position: absolute; inset: 24px; padding: 30px 34px; text-align: center; color: #e8dcc0;
    background: radial-gradient(ellipse at 50% 30%, #3b2f4a 0%, #1c1626 100%);
    border: 6px solid #b89a5b; border-radius: 22px;
    box-shadow: 0 0 0 3px #1c1626, 0 0 0 5px #b89a5b, 0 8px 30px rgba(0,0,0,.7); overflow: hidden; }
  h1 { font-size: 40px; letter-spacing: 3px; text-transform: uppercase; margin: 10px 0 20px;
    color: #e6c877; }
  .art { height: 250px; margin: 0 auto 26px; border: 3px solid #b89a5b; border-radius: 12px;
    background: radial-gradient(circle at 50% 40%, rgba(230,200,119,.35), rgba(230,200,119,0) 65%),
      linear-gradient(160deg, #2a2038, #0f0b15); }
  p { font-size: 23px; line-height: 1.4; margin: 0 0 14px; }
  .foot { margin-top: 18px; font-size: 22px; font-style: italic; color: #b89a5b; }
`;

/** The finished HTML page for one template. */
export function pressHtml(template: HandoutPressTemplate, content: PressContent): string {
  const { width, height } = PRESS_SIZES[template];
  const css = { letter: LETTER_CSS, notice: NOTICE_CSS, card: CARD_CSS }[template];
  const foot = content.footer ? `<div class="foot">${esc(content.footer)}</div>` : '';
  const inner = {
    letter: `<h1>${esc(content.title)}</h1>${paragraphs(content.body)}${foot}<div class="seal"></div>`,
    notice: `<h1>${esc(content.title)}</h1><hr>${paragraphs(content.body)}${foot}`,
    card: `<h1>${esc(content.title)}</h1><div class="art"></div>${paragraphs(content.body)}${foot}`,
  }[template];
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    `html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}` +
    `body{font-family:${SERIF};position:relative}.sheet h1,.sheet p,.sheet .foot{overflow-wrap:anywhere}${css}` +
    `</style></head><body><div class="sheet">${inner}</div><script>${FIT_SCRIPT}</script></body></html>`
  );
}

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

/** The browser to render with: FOUNDRY_AI_TOOL_PRESS_BROWSER, else Edge or Chrome. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | null {
  const wanted = env['FOUNDRY_AI_TOOL_PRESS_BROWSER'];
  if (wanted && existsSync(wanted)) return wanted;
  return BROWSERS.find(existsSync) ?? null;
}

const RENDER_TIMEOUT_MS = 30_000;

/** Set once the browser has said it has no usable sandbox here. */
let noSandboxNeeded = false;

/** Render one handout to PNG bytes. Throws a plain sentence when no browser is found. */
export async function renderPress(
  template: HandoutPressTemplate,
  content: PressContent,
  browser: string | null = findBrowser()
): Promise<Uint8Array> {
  if (!browser) {
    throw new Error(
      'The handout press needs Microsoft Edge, Google Chrome or Chromium on the computer the backend runs on, and found none (set FOUNDRY_AI_TOOL_PRESS_BROWSER to a browser program).'
    );
  }
  const { width, height } = PRESS_SIZES[template];
  const dir = await mkdtemp(path.join(tmpdir(), 'handout-press-'));
  try {
    const page = path.join(dir, 'page.html');
    const out = path.join(dir, 'out.png');
    const run = (noSandbox: boolean): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        execFile(
          browser,
          [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            ...(noSandbox ? ['--no-sandbox'] : []),
            `--user-data-dir=${path.join(dir, 'profile')}`,
            '--force-device-scale-factor=2',
            `--window-size=${width},${height}`,
            `--screenshot=${out}`,
            pathToFileURL(page).href,
          ],
          { timeout: RENDER_TIMEOUT_MS, windowsHide: true },
          error =>
            error ? reject(new Error(`The browser could not render: ${error.message}`)) : resolve()
        );
      });
    await writeFile(page, pressHtml(template, content), 'utf8');
    // A browser run as root (a container), or on a Linux that blocks unprivileged sandboxes
    // (Ubuntu 23.10+), refuses to start with its sandbox. The page is our own escaped markup,
    // so a second try without the sandbox is safe.
    const first = noSandboxNeeded || process.getuid?.() === 0;
    try {
      await run(first);
    } catch (error) {
      if (first || !/No usable sandbox/i.test(String(error))) throw error;
      // Remembered, so only the first render of the process pays for the failed start.
      noSandboxNeeded = true;
      await run(true);
    }
    // A loaded machine can make the browser exit cleanly before it has written the screenshot;
    // one more run settles it, and a second miss is a real failure.
    let png: Buffer;
    try {
      png = await readFile(out);
    } catch {
      await run(first || noSandboxNeeded);
      png = await readFile(out);
    }
    return new Uint8Array(png);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
