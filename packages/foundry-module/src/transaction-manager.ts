import { MODULE_ID } from './constants.js';

/**
 * Write-safety layer for multi-step Foundry mutations.
 *
 * Foundry document writes (creating an actor, dropping its token, patching its
 * data) are individually atomic but have no shared rollback: if step 3 of a
 * 4-step "spawn this encounter" flow fails, steps 1–2 have already hit the
 * world. {@link TransactionManager} closes that gap by recording each mutation
 * as a reversible {@link TransactionAction}; on failure the caller asks for a
 * rollback and the recorded actions are undone newest-first.
 *
 * The manager is deliberately a *ledger*, not an executor — callers perform the
 * real writes themselves and report what they did via {@link addAction}. That
 * keeps the rollback logic decoupled from the (large, system-specific) creation
 * code paths and lets a single recorded action describe how to reverse itself.
 */
export interface TransactionAction {
  type: 'create' | 'update' | 'delete';
  entityType: 'Actor' | 'Token' | 'Scene' | 'Item';
  entityId?: string;
  originalData?: any;
  newData?: any;
  rollbackAction?: () => Promise<void>;
}

export interface Transaction {
  id: string;
  timestamp: Date;
  description: string;
  actions: TransactionAction[];
  completed: boolean;
  rolledBack: boolean;
}

/** Result of attempting to undo a transaction. */
export interface RollbackResult {
  success: boolean;
  errors: string[];
}

export class TransactionManager {
  /** Newest completed transactions kept for after-the-fact rollback. */
  private static readonly HISTORY_LIMIT = 50;

  private readonly moduleId: string = MODULE_ID;

  /** Transactions still open for `addAction` (keyed by id). */
  private readonly active = new Map<string, Transaction>();

  /** Committed transactions, oldest-first, capped at {@link HISTORY_LIMIT}. */
  private readonly history: Transaction[] = [];

  /**
   * Open a new transaction and return its id. The transaction stays "active"
   * — accepting `addAction` calls — until it is committed or cancelled.
   */
  startTransaction(description: string): string {
    const id = foundry.utils.randomID();
    this.active.set(id, {
      id,
      timestamp: new Date(),
      description,
      actions: [],
      completed: false,
      rolledBack: false,
    });
    return id;
  }

  /**
   * Record a reversible mutation against an open transaction. Throws if the
   * transaction is not currently active (unknown id, already committed, or
   * cancelled).
   */
  addAction(transactionId: string, action: TransactionAction): void {
    const transaction = this.active.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found or already completed`);
    }
    transaction.actions.push(action);
  }

  /**
   * Mark a transaction as successfully completed: move it out of the active set
   * and into the bounded history (where it remains eligible for rollback).
   */
  commitTransaction(transactionId: string): void {
    const transaction = this.active.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    transaction.completed = true;
    this.active.delete(transactionId);

    this.history.push(transaction);
    if (this.history.length > TransactionManager.HISTORY_LIMIT) {
      this.history.shift();
    }
  }

  /**
   * Drop an active transaction without undoing its actions. Used to discard a
   * transaction whose writes never landed; a no-op for unknown ids.
   */
  cancelTransaction(transactionId: string): void {
    this.active.delete(transactionId);
  }

  /**
   * Undo every recorded action of a transaction, newest-first.
   *
   * Resolvable both for an active (uncommitted) transaction and for a committed
   * one still in history. A single action failing does not abort the rollback —
   * the error is collected and the remaining actions are still attempted — so a
   * partial failure leaves as little behind as possible. Throws only when the
   * transaction cannot be found or was already rolled back.
   */
  async rollbackTransaction(transactionId: string): Promise<RollbackResult> {
    const transaction = this.findTransaction(transactionId);
    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }
    if (transaction.rolledBack) {
      throw new Error(`Transaction ${transactionId} has already been rolled back`);
    }

    const errors: string[] = [];

    // Reverse order: later actions are undone before the earlier ones they
    // depend on, restoring the pre-transaction state most faithfully.
    for (let i = transaction.actions.length - 1; i >= 0; i--) {
      try {
        await this.revertAction(transaction.actions[i]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const entry = `Failed to rollback action ${i}: ${message}`;
        errors.push(entry);
        console.error(`[${this.moduleId}]`, entry);
      }
    }

    transaction.rolledBack = true;
    this.active.delete(transactionId);

    return { success: errors.length === 0, errors };
  }

  /** Snapshot of the currently-open transactions. */
  getActiveTransactions(): Transaction[] {
    return Array.from(this.active.values());
  }

  /** Defensive copy of the committed-transaction history. */
  getTransactionHistory(): Transaction[] {
    return [...this.history];
  }

  /** Forget all committed transactions. */
  clearHistory(): void {
    this.history.length = 0;
  }

  /** Canned action describing how to undo a freshly-created actor. */
  createActorCreationAction(actorId: string): TransactionAction {
    return { type: 'create', entityType: 'Actor', entityId: actorId };
  }

  /** Canned action describing how to undo a freshly-created token. */
  createTokenCreationAction(tokenId: string): TransactionAction {
    return { type: 'create', entityType: 'Token', entityId: tokenId };
  }

  /** Look up a transaction whether it is still active or already in history. */
  private findTransaction(transactionId: string): Transaction | undefined {
    return this.active.get(transactionId) ?? this.history.find(t => t.id === transactionId);
  }

  /** Dispatch a single action to its inverse operation. */
  private async revertAction(action: TransactionAction): Promise<void> {
    switch (action.type) {
      case 'create':
        return this.revertCreate(action);
      case 'update':
        return this.revertUpdate(action);
      case 'delete':
        return this.revertDelete(action);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /** Inverse of a create: delete the entity that was created. */
  private async revertCreate(action: TransactionAction): Promise<void> {
    if (!action.entityId) {
      throw new Error('Cannot rollback create action: missing entityId');
    }

    switch (action.entityType) {
      case 'Actor': {
        const actor = game.actors.get(action.entityId);
        if (actor) {
          await actor.delete();
        }
        return;
      }
      case 'Token': {
        const scene = (game.scenes as any).current;
        const token = scene?.tokens.get(action.entityId);
        if (token) {
          await token.delete();
        }
        return;
      }
      default:
        throw new Error(`Rollback not implemented for entity type: ${action.entityType}`);
    }
  }

  /** Inverse of an update: write the captured pre-update data back. */
  private async revertUpdate(action: TransactionAction): Promise<void> {
    if (!action.entityId || !action.originalData) {
      throw new Error('Cannot rollback update action: missing entityId or originalData');
    }

    switch (action.entityType) {
      case 'Actor': {
        const actor = game.actors.get(action.entityId);
        if (actor) {
          await actor.update(action.originalData);
        }
        return;
      }
      default:
        throw new Error(`Rollback not implemented for entity type: ${action.entityType}`);
    }
  }

  /** Inverse of a delete: recreate the entity from its captured data. */
  private async revertDelete(action: TransactionAction): Promise<void> {
    if (!action.originalData) {
      throw new Error('Cannot rollback delete action: missing originalData');
    }

    switch (action.entityType) {
      case 'Actor':
        await Actor.create(action.originalData);
        return;
      default:
        throw new Error(`Rollback not implemented for entity type: ${action.entityType}`);
    }
  }
}

// Shared singleton used by the actor/token creation paths in data-access.
export const transactionManager = new TransactionManager();
