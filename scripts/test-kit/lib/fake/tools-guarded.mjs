/**
 * The fake's guarded write path: plan-actor-change, plan-token-change (delete), apply-planned-change,
 * list-recent-changes and undo-change, with the real tools' result shapes. HP changes land on the
 * token's own HP (monster tokens are unlinked, as in Foundry), and an undo refuses when the
 * document was edited since.
 */
import { ToolFailure, addEvent, documentUuid, findTarget, newId, noteHpInStats } from './state.mjs';

/** @typedef {import('./state.mjs').World} World */

const FEATURE = 'live-play';

/** @param {World} w @param {string} summary @param {'write' | 'destructive'} risk @param {any[]} diff @param {any[]} ops @param {any[]} targets */
function createPlan(w, summary, risk, diff, ops, targets) {
  const now = Date.now();
  const view = {
    planId: newId(w, 'plan-'),
    feature: FEATURE,
    summary,
    target: 'foundry',
    risk,
    worldId: w.worldId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60000).toISOString(),
    diff,
    requires: { confirm: true, confirmDestructive: risk === 'destructive' },
  };
  w.plans.set(view.planId, { ...view, ops });
  return { ...view, targets, autoApply: false };
}

/** @param {World} w @param {any} args */
function planActorChange(w, args) {
  const names = /** @type {string[]} */ (args.targets ?? []);
  if (!names.length) throw new ToolFailure('Parameter error: targets is required');
  const amount = Number(args.amount);
  const ops = [];
  const diff = [];
  const targets = [];
  for (const name of names) {
    const found = findTarget(w, name);
    if (!found) throw new ToolFailure(`Failed to plan the change: no target named "${name}"`);
    const { token, actor } = found;
    const before = token.hp.value;
    let after;
    if (args.action === 'damage') after = Math.max(0, before - amount);
    else if (args.action === 'healing') after = Math.min(token.hp.max, before + amount);
    else throw new ToolFailure(`The fake plans only damage and healing, not "${args.action}"`);
    if (after === before) {
      throw new ToolFailure(`Failed to plan the change: Nothing to change: ${name}: no change`);
    }
    const uuid = documentUuid(w, token);
    ops.push({ kind: 'hp', tokenId: token.id, before, after });
    diff.push({
      op: ops.length - 1,
      kind: 'update',
      target: uuid,
      label: `Actor "${actor.name}"`,
      path: 'system.attributes.hp.value',
      before: { path: 'system.attributes.hp.value', present: true, value: before },
      after: { path: 'system.attributes.hp.value', present: true, value: after },
      text: `Actor "${actor.name}": HP ${before} → ${after}`,
    });
    const verb =
      args.action === 'damage' ? `${amount} ${args.damageType ?? ''} damage` : `heals ${amount}`;
    targets.push({
      target: name,
      actorUuid: uuid,
      line: `${name}: ${verb}, HP ${before} to ${after}`,
    });
  }
  const summary =
    args.action === 'damage'
      ? `${amount} ${args.damageType ?? ''} damage to ${names.join(', ')}`.replace('  ', ' ')
      : `Heal ${names.join(', ')} by ${amount}`;
  return createPlan(w, summary, 'write', diff, ops, targets);
}

/** @param {World} w @param {any} args */
function planTokenChange(w, args) {
  if (args.action !== 'delete') {
    throw new ToolFailure(`The fake plans only token deletes, not "${args.action}"`);
  }
  const ops = [];
  const diff = [];
  const targets = [];
  for (const name of /** @type {string[]} */ (args.tokens ?? [])) {
    const token = [...w.tokens.values()].find(
      t => t.sceneId === w.activeSceneId && (t.name === name || t.id === name)
    );
    if (!token) throw new ToolFailure(`Failed to plan the change: no token "${name}"`);
    const uuid = `Scene.${token.sceneId}.Token.${token.id}`;
    ops.push({ kind: 'deleteToken', token: { ...token, hp: { ...token.hp } } });
    diff.push({
      op: ops.length - 1,
      kind: 'delete',
      target: uuid,
      label: `Token "${token.name}"`,
      text: `Delete Token "${token.name}"`,
    });
    targets.push({ target: name, actorUuid: uuid, line: `${name}: delete` });
  }
  if (!ops.length) throw new ToolFailure('Parameter error: tokens is required');
  return createPlan(w, `Delete ${args.tokens.join(', ')}`, 'destructive', diff, ops, targets);
}

/**
 * Applies ops one way: forward (`apply`) or back (`undo`). Returns the document uuids touched.
 * @param {World} w @param {any[]} ops @param {'apply' | 'undo'} mode
 */
function runOps(w, ops, mode) {
  const docs = [];
  // Check everything first, so a refusal changes nothing.
  for (const op of ops) {
    if (op.kind !== 'hp') continue;
    const token = w.tokens.get(op.tokenId);
    const expected = mode === 'apply' ? op.before : op.after;
    if (!token || token.hp.value !== expected) {
      throw new ToolFailure(
        'The document was edited since the change was planned; nothing was changed.'
      );
    }
  }
  for (const op of ops) {
    if (op.kind === 'deleteToken') {
      if (mode === 'apply') {
        w.tokens.delete(op.token.id);
        if (w.combat)
          w.combat.combatants = w.combat.combatants.filter(c => c.tokenId !== op.token.id);
      } else w.tokens.set(op.token.id, { ...op.token, hp: { ...op.token.hp } });
      docs.push(`Scene.${op.token.sceneId}.Token.${op.token.id}`);
      continue;
    }
    const token = /** @type {import('./state.mjs').FakeToken} */ (w.tokens.get(op.tokenId));
    const actor = /** @type {import('./state.mjs').FakeActor} */ (w.actors.get(token.actorId));
    const from = token.hp.value;
    const to = mode === 'apply' ? op.after : op.before;
    token.hp.value = to;
    if (to !== from) {
      const kind = to < from ? 'damage' : 'healing';
      const amount = Math.abs(to - from);
      noteHpInStats(w, actor, kind, amount);
      addEvent(w, kind, {
        actor,
        description:
          kind === 'damage'
            ? `${actor.name} took ${amount} damage`
            : `${actor.name} regained ${amount} HP`,
        details: { amount, from, to },
      });
    }
    docs.push(documentUuid(w, token));
  }
  return docs;
}

/** @param {World} w @param {any} args @param {{confirm?: boolean, confirmDestructive?: boolean}} flags */
function applyPlannedChange(w, args, flags) {
  const plan = w.plans.get(String(args.planId));
  if (!plan) throw new ToolFailure(`Unknown or expired plan ${args.planId}`);
  if (plan.risk === 'destructive' && flags.confirmDestructive !== true) {
    throw new ToolFailure('This plan is destructive and needs confirmDestructive: true');
  }
  const documents = runOps(w, plan.ops, 'apply');
  w.plans.delete(plan.planId);
  const change = {
    changeId: newId(w, 'chg-'),
    planId: plan.planId,
    feature: plan.feature,
    summary: plan.summary,
    target: 'foundry',
    mode: 'apply',
    risk: plan.risk,
    appliedAt: new Date().toISOString(),
    diff: plan.diff.map((/** @type {any} */ d) => d.text),
    documents,
    ops: plan.ops,
  };
  w.changes.push(change);
  addEvent(w, 'gm-change', {
    description: `Applied: ${plan.summary}`,
    details: {
      changeId: change.changeId,
      feature: plan.feature,
      mode: 'apply',
      ops: plan.ops.length,
      documents,
    },
  });
  return publicChange(change);
}

/** @param {any} change */
function publicChange(change) {
  const { ops: _ops, ...rest } = change;
  return rest;
}

/** @param {World} w @param {any} args */
function undoChange(w, args) {
  const change = w.changes.find(c => c.changeId === args.changeId);
  if (!change) throw new ToolFailure(`Unknown change ${args.changeId}`);
  if (change.mode !== 'apply' || change.undoneBy) {
    throw new ToolFailure(`Change ${args.changeId} cannot be undone (already undone or an undo)`);
  }
  const documents = runOps(w, change.ops, 'undo');
  const undo = {
    changeId: newId(w, 'chg-'),
    planId: null,
    feature: change.feature,
    summary: `Undo: ${change.summary}`,
    target: 'foundry',
    mode: 'undo',
    risk: change.risk,
    appliedAt: new Date().toISOString(),
    undoOf: change.changeId,
    diff: change.diff.map((/** @type {string} */ d) => `undone: ${d}`),
    documents,
    ops: [],
  };
  change.undoneBy = undo.changeId;
  change.undoneAt = undo.appliedAt;
  w.changes.push(undo);
  addEvent(w, 'gm-change', {
    description: `Undone: ${change.summary}`,
    details: { changeId: undo.changeId, feature: change.feature, mode: 'undo', documents },
  });
  return publicChange(undo);
}

/** @type {Record<string, (w: World, args: any, flags: any) => any>} */
export const GUARDED_TOOLS = {
  'plan-actor-change': planActorChange,
  'plan-token-change': planTokenChange,
  'apply-planned-change': applyPlannedChange,
  'undo-change': undoChange,
  'list-recent-changes': (w, args) => ({
    changes: [...w.changes]
      .reverse()
      .slice(0, args.limit ?? 20)
      .map(c => ({ ...publicChange(c), canUndo: c.mode === 'apply' && !c.undoneBy })),
  }),
};
