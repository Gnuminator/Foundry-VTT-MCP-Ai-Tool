// Limits DDB-Importer's Muncher to the seven kept books plus the Monster Manual, so a later import cannot bring the
// dropped books back into aitool-content (the user, 2026-11-04). A GM script like seven-books-trim.js, but for the
// PC: DDB-Importer never goes to the Pi (docs/dev/PI-SETUP.md). Run it in the content-build world (test server A,
// world ai-tool-test) as a GM, for example pasted into a script macro there. The dry run (args.dryRun, or no args)
// only reports. It sets two world settings of ddb-importer and nothing else:
//   munching-policy-use-source-filter = true
//   munching-policy-muncher-sources   = the DDB source ids below
// DDB source ids (the module's data/fallback-config.json): 145 PHB 2024, 146 DMG 2024, 6 CoS, 26 CoSCO, 67 TCoE,
// 27 XGtE, 85 MotM, 5 MM 2014, 147 MM 2024. The Monster Manual stays so monster imports for adventures still work; its
// spells and items are not wanted either, so run seven-books-trim.js on the Pi after every import (stage 22) and the
// cleanup chain (phbWins, repairDroppedLinks, verify) in the content build.
const ID = 'ddb-importer';
const SOURCE_IDS = [145, 146, 6, 26, 67, 27, 85, 5, 147];
const FILTER = 'munching-policy-use-source-filter';
const SOURCES = 'munching-policy-muncher-sources';
const dry = args?.dryRun ?? true;
const log = t => (args?.log ? args.log(t) : console.log(t));
if (!game.user.isGM) throw new Error('run this as a GM');
for (const key of [FILTER, SOURCES]) {
  if (!game.settings.settings.has(`${ID}.${key}`))
    throw new Error(
      `${ID} does not register ${key}: is the module active, and is it version 7.5 or newer?`
    );
}
const now = {
  filter: game.settings.get(ID, FILTER),
  sources: [...game.settings.get(ID, SOURCES)].map(Number).sort((a, b) => a - b),
};
const wanted = [...SOURCE_IDS].sort((a, b) => a - b);
const todo = [];
if (now.filter !== true) todo.push(FILTER);
if (JSON.stringify(now.sources) !== JSON.stringify(wanted)) todo.push(SOURCES);
log(
  `now: filter ${now.filter}, sources ${JSON.stringify(now.sources)}; wanted: filter true, sources ${JSON.stringify(wanted)}`
);
log(todo.length ? `to change: ${todo.join(', ')}` : 'nothing to change');
if (dry || !todo.length) return { todo };
if (todo.includes(FILTER)) await game.settings.set(ID, FILTER, true);
if (todo.includes(SOURCES)) await game.settings.set(ID, SOURCES, wanted);
const after = {
  filter: game.settings.get(ID, FILTER),
  sources: [...game.settings.get(ID, SOURCES)].map(Number).sort((a, b) => a - b),
};
if (after.filter !== true || JSON.stringify(after.sources) !== JSON.stringify(wanted))
  throw new Error(`read-back does not match: ${JSON.stringify(after)}`);
log('verified');
return { changed: todo };
