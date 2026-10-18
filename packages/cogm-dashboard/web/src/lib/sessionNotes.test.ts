// The notes card's words and buttons. sanitizeNotesHtml needs a DOM, so e2e/after.spec.ts covers it.
import { describe, expect, it } from 'vitest';

import { notesView, pipelineView, type SessionNotes } from './sessionNotes';

const base: SessionNotes = { sessionId: 's1', title: 'Session 3', status: 'staged', autoPut: true };

describe('notesView', () => {
  it('waits for what is missing and offers only Read', () => {
    const v = notesView({ ...base, waitingFor: ['foundry', 'feature-off'] });
    expect(v.status).toBe('Waiting');
    expect(v.tone).toBe('off');
    expect(v.actions).toEqual(['read']);
    expect(v.line).toContain('a GM in Foundry');
    expect(v.line).toContain('Session notes (writes)');
    expect(v.aboutSwitch).toBe(true);
  });

  it('offers Put in Foundry after an Undo', () => {
    const v = notesView({ ...base, autoPut: false });
    expect(v.actions).toEqual(['read', 'put']);
    expect(v.line).toContain('taken out with Undo');
  });

  it('offers Approve and Undo while the notes are in Foundry and the Recap is not revealed', () => {
    const v = notesView({
      ...base,
      status: 'in-foundry',
      changeId: 'c1',
      putAt: '2026-10-18T20:00:00Z',
    });
    expect(v.status).toBe('In Foundry');
    expect(v.tone).toBe('on');
    expect(v.actions).toEqual(['read', 'approve', 'undo']);
    expect(v.line).toContain('waits in the Handouts queue');
  });

  it('takes Undo away once the players have the Recap, and Approve once approved', () => {
    const revealed = notesView({
      ...base,
      status: 'in-foundry',
      changeId: 'c1',
      recapRevealed: true,
    });
    expect(revealed.actions).toEqual(['read', 'approve']);
    expect(revealed.line).toContain('revealed to the players');
    const approved = notesView({
      ...base,
      status: 'in-foundry',
      changeId: 'c1',
      approvedAt: '2026-10-18T21:00:00Z',
    });
    expect(approved.actions).toEqual(['read', 'undo']);
  });

  it('says approved, keeps the audio line and shows Put when Undo took the notes out', () => {
    const v = notesView({ ...base, status: 'approved', approvedBy: 'reveal', autoPut: false });
    expect(v.status).toBe('Approved');
    expect(v.readQuiet).toBe(true);
    expect(v.line).toContain('by revealing the Recap');
    expect(v.line).toContain('audio is kept');
    expect(v.line).toContain('not in Foundry now');
    expect(v.actions).toEqual(['read', 'put']);
  });

  it('says how the last pass ended and flags problems', () => {
    const at = '2026-10-18T09:00:00+02:00';
    expect(pipelineView({ session: 's', state: 'published', message: 'x', at }).problem).toBe(
      false
    );
    const failed = pipelineView({ session: 's', state: 'failed', message: 'exit 3', at });
    expect(failed.problem).toBe(true);
    expect(failed.line).toContain('failed');
    expect(failed.line).toContain('exit 3');
    expect(pipelineView({ session: 's', state: 'incomplete', message: '' }).line).toContain('raw');
    expect(pipelineView({ session: 's', state: 'waiting', message: '' }).problem).toBe(false);
  });

  it('shows the last error', () => {
    expect(notesView({ ...base, lastError: 'boom' }).warn).toBe('Last try: boom');
    expect(notesView(base).warn).toBeNull();
  });
});
