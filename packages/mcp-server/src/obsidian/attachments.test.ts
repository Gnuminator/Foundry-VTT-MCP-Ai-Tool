/**
 * Image copies for the mirror and Library (design 13.5): Foundry paths map to safe vault paths,
 * images are fetched over HTTP from Foundry's origin once, and nothing outside the data root,
 * no web page and no non-image is ever copied.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AttachmentStore, type Fetcher } from './attachments.js';

let dir: string;
let fetched: string[];

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'attachments-'));
  fetched = [];
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

function respond(body: string, type = 'image/png', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': type } });
}

const okFetcher: Fetcher = url => {
  fetched.push(url);
  return Promise.resolve(respond(`bytes of ${url}`));
};

function store(fetcher: Fetcher = okFetcher, origin: string | null = null): AttachmentStore {
  const s = new AttachmentStore(dir, 'test-world', origin, fetcher, () => Date.now());
  s.setAllowed(true, null);
  return s;
}

describe('AttachmentStore paths', () => {
  it('mirrors the Foundry path under AI Tool/Attachments, each segment made safe', () => {
    const s = store();
    expect(s.attachmentPath('ddb-images/books/maps/town map.webp')).toBe(
      'AI Tool/Attachments/ddb-images/books/maps/town map.webp'
    );
    expect(s.attachmentPath('/worlds/w/a%20b/c[1].png?v=2')).toBe(
      'AI Tool/Attachments/worlds/w/a b/c 1.png'
    );
  });

  it('refuses climbing paths, non-images, data URLs and other hosts', () => {
    const s = store(okFetcher, 'http://localhost:30001');
    for (const src of [
      '../secret.png',
      'a/../../b.png',
      'maps/clip.webm',
      'notes/handout.pdf',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'https://elsewhere.example/x.png',
      '',
    ]) {
      expect(s.attachmentPath(src), src).toBeNull();
    }
    expect(s.attachmentPath('http://localhost:30001/maps/a.jpg')).toBe(
      'AI Tool/Attachments/maps/a.jpg'
    );
  });

  it('embeds a copy as a vault wikilink, an external image as a remote image, else nothing', () => {
    const s = store();
    expect(s.embed('maps/a.jpg', 'A map')).toBe(
      '![[Campaigns/test-world/AI Tool/Attachments/maps/a.jpg]]'
    );
    expect(s.embed('tokens/b.png', 'x', 250)).toBe(
      '![[Campaigns/test-world/AI Tool/Attachments/tokens/b.png|250]]'
    );
    expect(s.embed('https://cdn.example/c.png', 'A [cow]')).toBe(
      '![A cow](https://cdn.example/c.png)'
    );
    expect(s.embed('maps/clip.webm', 'clip')).toBeNull();
  });

  it('embeds nothing while the git guard has not passed', () => {
    const s = new AttachmentStore(dir, 'test-world', null, okFetcher);
    expect(s.embed('maps/a.jpg', '')).toBeNull();
    s.setAllowed(false, 'tracked in git');
    expect(s.embed('maps/a.jpg', '')).toBeNull();
    expect(s.status().blocked).toBe('tracked in git');
  });
});

describe('AttachmentStore copies', () => {
  it('fetches each planned image once from the reported origin and skips files already there', async () => {
    const s = store();
    s.embed('maps/a.jpg', '');
    s.embed('maps/a.jpg', '');
    s.embed('tokens/b c.png', '');
    expect(await s.flush(Date.now() + 10_000)).toBe(0); // no origin yet
    s.setOrigin('http://localhost:30001');
    expect(await s.flush(Date.now() + 10_000)).toBe(2);
    expect(fetched.sort()).toEqual([
      'http://localhost:30001/maps/a.jpg',
      'http://localhost:30001/tokens/b%20c.png',
    ]);
    const copy = await fsp.readFile(
      path.join(dir, 'AI Tool', 'Attachments', 'maps', 'a.jpg'),
      'utf8'
    );
    expect(copy).toBe('bytes of http://localhost:30001/maps/a.jpg');
    expect(await s.flush(Date.now() + 10_000)).toBe(0);
    expect(fetched).toHaveLength(2);
    expect(s.status()).toMatchObject({ copied: 2, pending: 0, failed: [], blocked: null });
  });

  it('prefers FOUNDRY_AI_FOUNDRY_URL over the reported origin', async () => {
    const s = store(okFetcher, 'http://foundry.internal:30000');
    s.setOrigin('https://public.example');
    s.embed('maps/a.jpg', '');
    await s.flush(Date.now() + 10_000);
    expect(fetched).toEqual(['http://foundry.internal:30000/maps/a.jpg']);
  });

  it('refuses a web page (a login page) and an error, and keeps them for the status', async () => {
    const s = store(url =>
      Promise.resolve(
        url.endsWith('a.jpg')
          ? respond('<html>login</html>', 'text/html')
          : respond('', 'image/png', 404)
      )
    );
    s.setOrigin('http://localhost:30001');
    s.embed('maps/a.jpg', '');
    s.embed('maps/b.jpg', '');
    expect(await s.flush(Date.now() + 10_000)).toBe(0);
    const failed = s
      .status()
      .failed.map(f => `${f.path}: ${f.error}`)
      .join('\n');
    expect(failed).toContain('web page');
    expect(failed).toContain('404');
    await expect(
      fsp.stat(path.join(dir, 'AI Tool', 'Attachments', 'maps', 'a.jpg'))
    ).rejects.toThrow();
  });

  it('remembers planned images across a restart (the manifest) and fetches what is missing', async () => {
    const first = store();
    first.embed('maps/a.jpg', '');
    // No origin: nothing is fetched, but the manifest is saved.
    await first.flush(Date.now() + 10_000);
    const second = store(okFetcher, 'http://localhost:30001');
    expect(await second.flush(Date.now() + 10_000)).toBe(1);
    expect(fetched).toEqual(['http://localhost:30001/maps/a.jpg']);
  });

  it('accepts a base URL with a route prefix and joins paths below it', async () => {
    const s = store();
    s.setOrigin('https://host.example/foundry/?x');
    s.setOrigin('https://host.example/foundry');
    expect(s.attachmentPath('https://host.example/foundry/maps/a.jpg')).toBe(
      'AI Tool/Attachments/maps/a.jpg'
    );
    s.embed('maps/a.jpg', '');
    await s.flush(Date.now() + 10_000);
    expect(fetched).toEqual(['https://host.example/foundry/maps/a.jpg']);
  });

  it('streams a body without a length and stops reading past the cap', async () => {
    let pulled = 0;
    const endless: Fetcher = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller): void {
              pulled += 1;
              if (pulled > 50) controller.close();
              else controller.enqueue(new Uint8Array(300));
            },
          }),
          { status: 200, headers: { 'content-type': 'image/png' } }
        )
      );
    const s = new AttachmentStore(
      dir,
      'test-world',
      'http://localhost:30001',
      endless,
      Date.now,
      1000
    );
    s.setAllowed(true, null);
    s.embed('maps/huge.png', '');
    expect(await s.flush(Date.now() + 10_000)).toBe(0);
    expect(s.status().failed[0]?.error).toContain('larger than 1000 bytes');
    expect(pulled).toBeLessThan(10);
    await expect(
      fsp.stat(path.join(dir, 'AI Tool', 'Attachments', 'maps', 'huge.png'))
    ).rejects.toThrow();
  });

  it('never follows a hand-edited manifest outside the attachments folder', async () => {
    const manifest = path.join(dir, 'AI Tool', 'Attachments', '.ai-tool-attachments.json');
    await fsp.mkdir(path.dirname(manifest), { recursive: true });
    await fsp.writeFile(
      manifest,
      JSON.stringify({
        schema: 1,
        images: [{ source: '../../evil.png' }, { source: 'ok/fine.png' }],
      })
    );
    const s = store(okFetcher, 'http://localhost:30001');
    await s.flush(Date.now() + 10_000);
    expect(fetched).toEqual(['http://localhost:30001/ok/fine.png']);
  });
});

describe('AttachmentStore names', () => {
  it('keys vault paths case-folded and gives a colliding source a hash suffix', () => {
    const s = store();
    const upper = s.embed('Maps/Town.png', '');
    const lower = s.embed('maps/town.png', '');
    expect(upper).toBe('![[Campaigns/test-world/AI Tool/Attachments/Maps/Town.png]]');
    expect(lower).toMatch(
      /^!\[\[Campaigns\/test-world\/AI Tool\/Attachments\/maps\/town-[0-9a-f]{8}\.png\]\]$/
    );
    // Two sources that the safe-name rules map to one name are told apart too.
    const bracket = s.embed('maps/c[1].png', '');
    const space = s.embed('maps/c 1.png', '');
    expect(bracket).not.toBe(space);
    // The same source keeps its name.
    expect(s.embed('/maps/town.png', '')).toBe(lower);
  });

  it('keeps the names it picked across a restart, whatever order the notes embed them in', async () => {
    const first = store();
    const upper = first.embed('Maps/Town.png', '');
    const lower = first.embed('maps/town.png', '');
    await first.flush(Date.now() + 10_000);
    const second = store();
    await second.load();
    expect(second.embed('maps/town.png', '')).toBe(lower);
    expect(second.embed('Maps/Town.png', '')).toBe(upper);
  });
});

describe('AttachmentStore cleanup', () => {
  function trashInto(list: string[]): (rel: string) => Promise<'trashed'> {
    return rel => {
      list.push(rel);
      return Promise.resolve('trashed');
    };
  }

  it('trashes only images that no note embeds any more', async () => {
    const s = store();
    s.beginOwner('A');
    s.embed('maps/a.jpg', '');
    s.embed('maps/b.jpg', '');
    s.endOwner(true);
    s.beginOwner('B');
    s.embed('maps/b.jpg', '');
    s.endOwner(true);
    // A re-renders without b: b still has B.
    s.beginOwner('A');
    s.embed('maps/a.jpg', '');
    s.endOwner(true);
    const trashed: string[] = [];
    expect(await s.collectGarbage(Date.now() + 10_000, trashInto(trashed))).toBe(0);
    // B's note was edited (not written): its old embeds stay counted.
    s.beginOwner('B');
    s.endOwner(false);
    expect(await s.collectGarbage(Date.now() + 10_000, trashInto(trashed))).toBe(0);
    // B re-renders without images: b goes to the trash, a stays.
    s.beginOwner('B');
    s.endOwner(true);
    expect(await s.collectGarbage(Date.now() + 10_000, trashInto(trashed))).toBe(1);
    expect(trashed).toEqual(['AI Tool/Attachments/maps/b.jpg']);
    expect(s.status().pending).toBe(1);
  });

  it('remembers owners across a restart, and never collects an image with an unknown owner', async () => {
    const first = store();
    first.beginOwner('A');
    first.embed('maps/a.jpg', '');
    first.endOwner(true);
    first.embed('maps/loose.jpg', ''); // outside any owner: unknown
    await first.flush(Date.now() + 10_000);
    const second = store();
    await second.load();
    second.dropOwner('A');
    const trashed: string[] = [];
    await second.collectGarbage(Date.now() + 10_000, trashInto(trashed));
    expect(trashed).toEqual(['AI Tool/Attachments/maps/a.jpg']);
  });
});
