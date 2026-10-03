/**
 * `GET /api/help/:page` (I-064): one GM guide page, rendered at build time into dist/help.json
 * (scripts/build-help.mjs). The dashboard's help panel shows it; nothing reads the docs at
 * request time. Before a build (tsx dev mode) the file is missing and the route says so.
 */
import { readFileSync } from 'fs';

import type { Express, Request, Response } from 'express';

export interface HelpPage {
  title: string;
  html: string;
}

interface HelpFile {
  pages: Record<string, HelpPage>;
}

const PAGE_NAME = /^[A-Za-z0-9-]{1,60}$/;

export interface HelpRouteOptions {
  /** dist/help.json; with several, the first that can be read. */
  file: string | URL | ReadonlyArray<string | URL>;
  requireGm: (req: Request, res: Response, next: () => void) => void;
}

export function mountHelpRoute(app: Express, options: HelpRouteOptions): void {
  let help: HelpFile | null | undefined;
  const load = (): HelpFile | null => {
    if (help !== undefined) return help;
    help = null;
    const files: ReadonlyArray<string | URL> =
      typeof options.file === 'string' || options.file instanceof URL
        ? [options.file]
        : options.file;
    for (const file of files) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<HelpFile>;
        if (parsed.pages && typeof parsed.pages === 'object') {
          help = { pages: parsed.pages };
          break;
        }
      } catch {
        // Not built here; try the next place.
      }
    }
    return help;
  };

  app.get('/api/help/:page', options.requireGm, (req: Request, res: Response) => {
    const name = String(req.params.page ?? '');
    const file = load();
    if (!file) {
      res.status(404).json({ error: 'The help is built with npm run build (dist/help.json).' });
      return;
    }
    const page = PAGE_NAME.test(name) ? file.pages[name] : undefined;
    if (!page || !Object.prototype.hasOwnProperty.call(file.pages, name)) {
      res.status(404).json({ error: `No help page "${name}".` });
      return;
    }
    res.json({ page: name, title: page.title, html: page.html });
  });
}
