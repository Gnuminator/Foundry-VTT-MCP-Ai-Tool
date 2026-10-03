/**
 * The host-only control method `session_notes` (recap lane, D-087). Never an MCP tool: the
 * stdio wrapper forwards only `list_tools` and `call_tool`, so Claude cannot reach it. The
 * pipeline calls `stage` and `status`; the dashboard server exposes `list`, `get`, `put` and
 * `approve` on GM routes.
 */
import type { SessionNotesService } from './service.js';
import { SessionNotesError } from './types.js';

export const SESSION_NOTES_ACTIONS = ['stage', 'list', 'get', 'put', 'approve', 'status'] as const;

export async function handleSessionNotes(
  service: SessionNotesService,
  params: unknown
): Promise<unknown> {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  switch (p.action) {
    case 'stage':
      return service.stage(p);
    case 'list':
      return service.list();
    case 'get':
      return service.get(p);
    case 'put':
      return service.put(p);
    case 'approve':
      return service.approve(p);
    case 'status':
      return service.status(p);
    default:
      throw new SessionNotesError(
        'bad-request',
        `action must be one of ${SESSION_NOTES_ACTIONS.join(', ')}`
      );
  }
}

/** The control frame's error: `{message, code}` (code only for a session-notes refusal). */
export function controlError(error: unknown): { message: string; code?: string } {
  if (error instanceof SessionNotesError) return { message: error.message, code: error.code };
  const message = error instanceof Error ? error.message : String(error);
  // A guarded write the module or the Undo guard refused because things changed.
  if (/^Conflict, nothing was written/.test(message)) return { message, code: 'conflict' };
  return { message };
}
