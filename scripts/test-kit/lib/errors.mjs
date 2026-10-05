/**
 * Error types of the test kit. The CLI maps them to exit codes (EnvError = 2, everything else a
 * failure = 1); the runner maps them to step results.
 */

/** The environment is not ready or a target is refused: not a test failure (exit code 2). */
export class EnvError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'EnvError';
  }
}

/** Thrown by `t.skip(reason)`; ends the scenario as skipped. */
export class SkipError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SkipError';
  }
}

/** Thrown by `t.check` and `t.equal`; `details` is attached to the report. */
export class KitAssertion extends Error {
  /**
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(message, details) {
    super(message);
    this.name = 'KitAssertion';
    this.details = details;
  }
}

/** A bridge tool call that failed, as the dashboard reported it. */
export class KitToolError extends Error {
  /**
   * @param {{kind?: string, status?: number, error?: string, name?: string, reply?: unknown}} info
   *   `name` is the tool's name (kept as `.tool`; `.name` stays the error class name).
   */
  constructor({ kind, status, error, name, reply } = {}) {
    const text = String(error ?? 'failed').replace(/\s+/g, ' ');
    super(name ? `${name}: ${text}` : text);
    this.name = 'KitToolError';
    this.kind = kind ?? 'error';
    this.status = status;
    this.error = text;
    this.tool = name;
    this.reply = reply;
  }
}
