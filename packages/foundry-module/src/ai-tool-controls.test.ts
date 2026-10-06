/**
 * Tests for the GM-only "AI Tool" scene-controls group (I-108) and for the
 * "AI changes updated" signal that refreshes the window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  AI_TOOL_BUTTONS,
  AI_TOOL_CONTROL,
  addAiToolControls,
  registerAiToolControls,
} from './ai-tool-controls.js';
import {
  AI_CHANGES_SOCKET_TYPE,
  announceAiChangesUpdated,
  handleAiChangesSocketMessage,
  onAiChangesUpdated,
} from './ai-changes-signal.js';

const g = globalThis as any;
let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  restore?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function install(isGM: boolean): void {
  world = createTestWorld({ foundryVersion: '14.368', currentUser: { isGM } });
  restore = world.install();
}

describe('the AI Tool scene-controls group', () => {
  it('adds a layer-less group with one button tool for a GM', () => {
    install(true);
    const controls: Record<string, any> = { tokens: { name: 'tokens' } };

    addAiToolControls(controls);

    const group = controls[AI_TOOL_CONTROL];
    expect(group).toMatchObject({ name: 'aiTool', title: 'AI Tool', visible: true });
    expect(group.layer).toBeUndefined();
    expect(group.order).toBeGreaterThan(10);
    expect(Object.keys(group.tools)).toEqual(['aiChanges']);
    expect(group.tools.aiChanges).toMatchObject({
      name: 'aiChanges',
      title: 'AI changes',
      order: 1,
      button: true,
      visible: true,
    });
    expect(group.tools.aiChanges.toggle).toBeUndefined();
    expect(controls.tokens).toEqual({ name: 'tokens' });
  });

  it('adds nothing for a player', () => {
    install(false);
    const controls: Record<string, any> = {};
    addAiToolControls(controls);
    expect(controls).toEqual({});
  });

  it('leaves room for more buttons: each one becomes its own ordered button tool', () => {
    install(true);
    const controls: Record<string, any> = {};
    addAiToolControls(controls, [
      ...AI_TOOL_BUTTONS,
      { name: 'handouts', title: 'Handouts', icon: 'fa-solid fa-scroll', open: vi.fn() },
    ]);
    expect(Object.keys(controls.aiTool.tools)).toEqual(['aiChanges', 'handouts']);
    expect(controls.aiTool.tools.handouts).toMatchObject({ order: 2, button: true });
  });

  it('a click runs the button and reports a failure as a notification', async () => {
    install(true);
    const open = vi.fn().mockRejectedValue(new Error('boom'));
    const controls: Record<string, any> = {};
    addAiToolControls(controls, [{ name: 'x', title: 'X', icon: 'fa-solid fa-x', open }]);

    controls.aiTool.tools.x.onChange(new Event('click'), true);
    await vi.waitFor(() => expect(world.notifications).toHaveLength(1));

    expect(open).toHaveBeenCalledTimes(1);
    expect(world.notifications[0]).toMatchObject({ level: 'error' });
    expect(world.notifications[0]?.message).toContain('boom');
  });

  it('registerAiToolControls hooks getSceneControlButtons', () => {
    install(true);
    registerAiToolControls();
    const controls: Record<string, any> = {};
    g.Hooks.callAll('getSceneControlButtons', controls);
    expect(controls.aiTool.tools.aiChanges.button).toBe(true);
  });
});

describe('the AI changes signal', () => {
  it('announce emits one module socket message and tells local listeners', () => {
    install(true);
    const emit = vi.fn();
    g.game.socket = { emit, on: vi.fn() };
    const listener = vi.fn();
    const stop = onAiChangesUpdated(listener);

    announceAiChangesUpdated();

    expect(emit).toHaveBeenCalledWith('module.foundry-mcp-bridge', {
      type: AI_CHANGES_SOCKET_TYPE,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    announceAiChangesUpdated();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('the socket handler refreshes GM clients only, and ignores other messages', () => {
    install(true);
    const listener = vi.fn();
    const stop = onAiChangesUpdated(listener);

    expect(handleAiChangesSocketMessage({ type: AI_CHANGES_SOCKET_TYPE })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handleAiChangesSocketMessage({ type: 'requestMessageUpdate' })).toBe(false);
    expect(handleAiChangesSocketMessage(null)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    g.game.user = { isGM: false };
    expect(handleAiChangesSocketMessage({ type: AI_CHANGES_SOCKET_TYPE })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a failing listener or socket never breaks the announce', () => {
    install(true);
    g.game.socket = {
      emit: (): void => {
        throw new Error('socket down');
      },
      on: vi.fn(),
    };
    const after = vi.fn();
    const stopA = onAiChangesUpdated(() => {
      throw new Error('listener bug');
    });
    const stopB = onAiChangesUpdated(after);
    expect(() => announceAiChangesUpdated()).not.toThrow();
    expect(after).toHaveBeenCalled();
    stopA();
    stopB();
  });
});
