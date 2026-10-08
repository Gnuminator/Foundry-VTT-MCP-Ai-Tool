// @ts-check
// Writes the account's 5-hour and weekly plan figures to the project dashboard's data folder
// (plan.json), so the page can show them. Only the window kind, percent and reset time are
// written; nothing about the session itself. Claude Code function hooks (plugin API, early access).

/**
 * @param {import('claude-code').EngineInterface} $
 * @param {{ kind: string, percentUsed: number, resetsAt?: string }[]} windows
 */
async function save($, windows) {
  if (!windows.length) return;
  const home = await $.env.get('USERPROFILE');
  const custom = await $.env.get('PROJECT_DASHBOARD_DATA');
  const dir = custom || (home ? `${home}\\.foundry-ai-tool\\project-dashboard` : undefined);
  if (!dir) return;
  const rateLimits = windows.map(w => ({
    kind: w.kind,
    percentUsed: w.percentUsed,
    resetsAt: w.resetsAt ?? null,
  }));
  await $.fs.write(
    `${dir}\\plan.json`,
    JSON.stringify({ at: new Date().toISOString(), rateLimits }) + '\n'
  );
}

/** @type {import('claude-code').Register} */
export const register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    const usage = await $.session.usage().catch(() => undefined);
    if (usage) await save($, usage.rateLimits).catch(() => undefined);
    return result;
  });

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await save($, e.rateLimits).catch(() => undefined);
    return next(e);
  });
  return undefined;
};
