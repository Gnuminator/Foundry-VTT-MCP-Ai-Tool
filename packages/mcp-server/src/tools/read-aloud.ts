/**
 * `get-read-aloud` (I-167): the boxed read-aloud text of the pages a scene links (pages a link names first, then whole-entry pages by sort order).
 * The module hands over the raw page HTML (`getScenePages`); the boxes are picked out here with
 * the same class test the Obsidian export uses. Nothing is stored: the text is read from the
 * world when asked and returned to the GM, so no book text lives in the repo or the vault.
 */
import { toolRef, unwrapBridgeReply, type BridgeRefusal } from '@gnuminator/shared';
import { parseDOM } from 'htmlparser2';
import { z } from 'zod';

import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';

type DomNode = ReturnType<typeof parseDOM>[number];

interface ElementNode {
  type: string;
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
}

/** The classes the official book import (and the Obsidian export) use for a boxed read-aloud. */
const READ_ALOUD_CLASS = /^read-aloud-text$|Boxed-Text/;
const SKIPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg']);
const BLOCKS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'blockquote',
  'section',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

interface ReadAloudBlock {
  text: string;
}

interface ReadAloudPage {
  journalId: string;
  journalName: string;
  pageId: string;
  pageName: string;
  from: 'scene' | 'note';
  blocks: ReadAloudBlock[];
}

interface GetReadAloudResult {
  success: true;
  sceneId: string;
  sceneName: string;
  /** Pages that have at least one read-aloud box. */
  pages: ReadAloudPage[];
  /** How many linked pages had none (so the card can say "nothing boxed" rather than "no link"). */
  pagesWithoutBoxes: number;
  /** Text pages the scene links in all, and how many of them were read (a cut shows here). */
  linkedPages: number;
  readPages: number;
}

function isElement(node: DomNode): node is DomNode & ElementNode {
  const n = node as Partial<ElementNode>;
  return typeof n.name === 'string' && Array.isArray(n.children) && n.type !== 'directive';
}

function hasReadAloudClass(el: ElementNode): boolean {
  return (el.attribs.class ?? '').split(/\s+/).some(name => READ_ALOUD_CLASS.test(name));
}

/** Foundry enrichers to plain words: `@UUID[...]{Label}` to Label, `[[/r 1d6]]` to 1d6. */
function plainEnrichers(text: string): string {
  return text
    .replace(/[@&][A-Za-z]+\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/[@&][A-Za-z]+\[([^\]]*)\]/g, '$1')
    .replace(/\[\[(?:\/\w+\s+)?([^\]]*?)\]\]/g, '$1');
}

/** The text of one box: block elements become paragraphs, `br` a line break. */
function boxText(nodes: DomNode[]): string {
  let out = '';
  for (const node of nodes) {
    const data = node as { type?: unknown; data?: unknown };
    if (data.type === 'text' && typeof data.data === 'string') {
      out += data.data.replace(/\s+/g, ' ');
    } else if (isElement(node) && !SKIPPED.has(node.name)) {
      if (node.name === 'br') out += '\n';
      else if (BLOCKS.has(node.name)) out += `\n\n${boxText(node.children)}\n\n`;
      else out += boxText(node.children);
    }
  }
  return out;
}

function tidy(text: string): string {
  return plainEnrichers(text)
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The read-aloud boxes of one page's HTML, in document order, empty boxes dropped. */
export function extractReadAloud(html: string): ReadAloudBlock[] {
  const blocks: ReadAloudBlock[] = [];
  const walk = (nodes: DomNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node) || SKIPPED.has(node.name)) continue;
      if (hasReadAloudClass(node)) {
        const text = tidy(boxText(node.children));
        if (text) blocks.push({ text });
      } else {
        walk(node.children);
      }
    }
  };
  walk(parseDOM(html));
  return blocks;
}

interface ScenePagesReply {
  sceneId: string;
  sceneName: string;
  totalPages?: number;
  pages: Array<{
    journalId: string;
    journalName: string;
    pageId: string;
    pageName: string;
    from: 'scene' | 'note';
    html: string;
  }>;
}

interface ReadAloudToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class ReadAloudTools {
  private readonly foundryClient: FoundryClient;
  private readonly logger: Logger;

  constructor(options: ReadAloudToolsOptions) {
    this.foundryClient = options.foundryClient;
    this.logger = options.logger.child({ component: 'ReadAloudTools' });
  }

  getToolDefinitions(): { name: string; description: string; inputSchema: unknown }[] {
    return [
      {
        name: 'get-read-aloud',
        description:
          'GM ONLY. The boxed read-aloud text of the journal pages a scene links (the scene itself ' +
          'and its map notes: pages a link names come first, then the pages of a whole linked ' +
          'entry), ready to read to the table. Read from the world when asked; nothing is ' +
          'stored. Pages without a boxed text are counted, not listed. At most 12 pages are ' +
          'read; linkedPages and readPages show a cut.',
        inputSchema: {
          type: 'object',
          properties: {
            sceneId: {
              type: 'string',
              description: 'The scene to read (default: the scene on screen).',
              ...toolRef('scene', 'id'),
            },
          },
        },
      },
    ];
  }

  async handleGetReadAloud(args: unknown): Promise<GetReadAloudResult> {
    const { sceneId } = z.object({ sceneId: z.string().optional() }).parse(args ?? {});
    try {
      const reply = unwrapBridgeReply(
        (await this.foundryClient.query('foundry-mcp-bridge.getScenePages', {
          ...(sceneId ? { sceneId } : {}),
        })) as ScenePagesReply | BridgeRefusal,
        'get-read-aloud'
      );
      const pages: ReadAloudPage[] = [];
      let pagesWithoutBoxes = 0;
      for (const page of reply.pages ?? []) {
        const blocks = extractReadAloud(page.html);
        if (blocks.length === 0) {
          pagesWithoutBoxes += 1;
          continue;
        }
        pages.push({
          journalId: page.journalId,
          journalName: page.journalName,
          pageId: page.pageId,
          pageName: page.pageName,
          from: page.from,
          blocks,
        });
      }
      return {
        success: true,
        sceneId: reply.sceneId,
        sceneName: reply.sceneName,
        pages,
        pagesWithoutBoxes,
        linkedPages: reply.totalPages ?? (reply.pages ?? []).length,
        readPages: (reply.pages ?? []).length,
      };
    } catch (error) {
      this.logger.error('Failed to get read-aloud text', error);
      throw error;
    }
  }
}
