// Session notes (recap lane, D-087): the notes the session pipeline wrote from the recording. The
// bridge puts them into a GM-only "Session notes" journal by itself (logged, with Undo) and queues
// the Recap page for reveal; the After view's card says where they are. Port of the old page's
// renderSessionNotes (public/app.js). Pure, so it is tested without a page. GM only: nothing here
// reaches /player.

/** The latest session's notes (GET /api/session-notes, session-notes-route.ts); fields used here. */
export interface SessionNotes {
  sessionId: string;
  title?: string;
  date?: string;
  status: 'staged' | 'in-foundry' | 'approved';
  /** Whether the bridge puts the notes into Foundry by itself (false after an Undo). */
  autoPut?: boolean;
  waitingFor?: string[];
  putAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  changeId?: string;
  journalUuid?: string;
  recapRevealed?: boolean;
  lastError?: string;
}

/** One page of the notes with its HTML (GET /api/session-notes/:id). */
export interface NotesPage {
  key?: string;
  title?: string;
  html?: string;
}

const NOTES_WAITING: Record<string, string> = {
  foundry: 'a GM in Foundry (open Foundry and join as the GM)',
  'writes-off': '"Allow Write Operations" (it is off)',
  'feature-off': 'the switch "AI Tool: Session notes (writes)" (it is off)',
};

/** What the card can offer. */
export type NotesAction = 'read' | 'put' | 'approve' | 'undo';

export interface NotesView {
  title: string;
  /** The pill: Waiting, In Foundry or Approved. */
  status: string;
  /** Waiting is the amber pill, the others the green one. */
  tone: 'on' | 'off';
  line: string;
  warn: string | null;
  /** The buttons in order; Read is quiet once the notes are approved. */
  actions: NotesAction[];
  /** Whether Read is the plain button instead of the highlighted one. */
  readQuiet: boolean;
  /** Whether the "About the switch" link shows (the session notes switch is off). */
  aboutSwitch: boolean;
}

/** How the last notes pass ended (GET /api/session-notes/pipeline: notes/status.json). */
export interface PipelineStatus {
  session: string;
  state: 'done' | 'paused' | 'incomplete' | 'failed' | 'waiting' | 'published';
  message: string;
  at?: string;
}

const PIPELINE_WORDS: Record<PipelineStatus['state'], string> = {
  done: 'The notes are written.',
  paused: 'Paused (usage limit); the next pass continues.',
  incomplete: 'Some scenes are still raw; the next pass tries them again.',
  failed: 'The last pass failed; the next pass tries again.',
  waiting: 'Written, waiting for Foundry to take them; the next pass tries again.',
  published: 'The notes went to Foundry.',
};

/** Whether a staged notes id belongs to this session folder (the pipeline's id-safe folder name). */
export function samePipelineSession(sessionId: string, folder: string): boolean {
  return (
    sessionId ===
    folder
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 80)
  );
}

/** The card's line about the last pass, and whether it is a problem (amber). */
export function pipelineView(p: PipelineStatus): { line: string; problem: boolean; pill: string } {
  const when = notesTime(p.at);
  const detail = p.message && p.state !== 'published' && p.state !== 'done' ? ` ${p.message}` : '';
  return {
    pill: p.state === 'failed' ? 'Failed' : p.state === 'published' ? 'Published' : 'Waiting',
    line: `Last notes pass${when ? ` (${when})` : ''}: ${PIPELINE_WORDS[p.state]}${detail}`,
    problem: p.state === 'failed' || p.state === 'incomplete' || p.state === 'paused',
  };
}

export function notesTime(iso: string | undefined): string {
  return iso
    ? new Date(iso).toLocaleString([], {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
}

/** The card for these notes: its words and its buttons, as the old page's renderSessionNotes. */
export function notesView(n: SessionNotes): NotesView {
  const waiting = Array.isArray(n.waitingFor) ? n.waitingFor : [];
  const actions: NotesAction[] = ['read'];
  let status: string;
  let line: string;
  if (n.status === 'staged') {
    status = 'Waiting';
    if (!n.autoPut) {
      line = 'Not in Foundry: they were taken out with Undo. Put them back when you want them.';
      actions.push('put');
    } else if (waiting.length > 0) {
      line = `They go into Foundry by themselves as soon as there is ${waiting
        .map(w => NOTES_WAITING[w] ?? w)
        .join(' and ')}.`;
    } else {
      line = 'Going into Foundry now.';
    }
  } else if (n.status === 'in-foundry') {
    status = 'In Foundry';
    line = `In the GM-only journal "Session notes" since ${notesTime(n.putAt)} (Undo is in Recent Changes). ${
      n.recapRevealed
        ? 'The Recap is revealed to the players.'
        : 'The Recap waits in the Handouts queue: reveal it there, or approve the notes without revealing.'
    }`;
    if (!n.approvedAt) actions.push('approve');
    // The bridge refuses Undo once the players have the Recap (D-087), so no button then.
    if (n.changeId && !n.recapRevealed) actions.push('undo');
  } else {
    // Approval stays once given (the audio is kept either way, D-097); whether the notes are in
    // Foundry is journalUuid (an Undo removes the whole put).
    status = 'Approved';
    line = `Approved ${n.approvedBy === 'reveal' ? 'by revealing the Recap' : ''} ${notesTime(n.approvedAt)}. The recording's audio is kept.`;
    if (!n.journalUuid) {
      line += ' The notes are not in Foundry now: they were taken out with Undo.';
      if (!n.autoPut) actions.push('put');
    } else if (n.changeId && !n.recapRevealed) {
      actions.push('undo');
    }
  }
  return {
    title: `Session notes: ${n.title || n.date || n.sessionId}`,
    status,
    tone: n.status === 'staged' ? 'off' : 'on',
    line: line.replace(/\s+/g, ' ').trim(),
    warn: n.lastError ? `Last try: ${n.lastError}` : null,
    actions,
    readQuiet: n.status === 'approved',
    aboutSwitch: waiting.includes('feature-off'),
  };
}

const NOTES_TAGS = new Set(['H2', 'H3', 'P', 'UL', 'OL', 'LI', 'EM', 'STRONG', 'BR']);
const DROPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT']);

/**
 * The notes' HTML with only plain text tags and no attributes, as an HTML string for the reader
 * pane. Everything outside the allowed tags is unwrapped (its text stays) or, for the tags that
 * run code or load content, dropped with its content.
 */
export function sanitizeNotesHtml(html: string | undefined): string {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const out = document.createElement('div');
  const walk = (src: Node, dst: Node): void => {
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(node.textContent ?? ''));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (NOTES_TAGS.has(el.tagName)) {
          const copy = document.createElement(el.tagName.toLowerCase());
          dst.appendChild(copy);
          walk(el, copy);
        } else if (!DROPPED.has(el.tagName)) {
          walk(el, dst);
        }
      }
    }
  };
  walk(doc.body, out);
  return out.innerHTML;
}
