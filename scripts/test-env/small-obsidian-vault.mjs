#!/usr/bin/env node
/**
 * Builds a small throwaway Obsidian vault for checking the AI Tool plugin by hand (the graph
 * commands "Hide / Show the Library in the graph", "Apply AI Tool graph colours").
 *
 *   node scripts/test-env/small-obsidian-vault.mjs [--dir C:\FoundryTest\obsidian-small]
 *
 * It holds the built plugin (run `npm run build -w packages/obsidian-plugin` first), a handful of
 * world notes with links, an adventure hub, and 3 books with 36 Library notes under
 * `Campaigns/ai-tool-test/AI Tool/Library/`. All text is made up: no book or campaign content.
 * Safe to run again: it rewrites its own files and leaves anything else in the folder alone.
 * Never point it at a real vault; it refuses a folder that already has notes it did not write.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const argDir = process.argv.indexOf('--dir');
const root = path.resolve(
  argDir > 0 ? (process.argv[argDir + 1] ?? '') : 'C:\\FoundryTest\\obsidian-small'
);
const world = 'ai-tool-test';
// Test server A's dashboard port, from the one ports source.
const dashboardPort = JSON.parse(readFileSync(path.join(repo, 'shared', 'ports.json'), 'utf8'))
  .ports.testA.dashboard;

const MARK = 'generated_by: small-obsidian-vault';

function write(rel, text) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const MARKER = '.small-obsidian-vault';

/** Only a missing folder, an empty one, or one this script made (it holds the marker file). */
function assertSafe() {
  if (argDir > 0 && !process.argv[argDir + 1]) throw new Error('--dir needs a folder.');
  if (!existsSync(root)) return;
  if (readdirSync(root).length === 0) return;
  if (existsSync(path.join(root, MARKER))) return;
  throw new Error(`${root} is not empty and was not made by this script; pick a new folder.`);
}

assertSafe();
mkdirSync(root, { recursive: true });
writeFileSync(path.join(root, MARKER), 'Made by scripts/test-env/small-obsidian-vault.mjs\n');

// Plugin
const dist = path.join(repo, 'packages', 'obsidian-plugin', 'dist');
const pluginDir = path.join(root, '.obsidian', 'plugins', 'foundry-ai-tool');
mkdirSync(pluginDir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  if (!existsSync(path.join(dist, f))) {
    throw new Error(
      `${path.join(dist, f)} is missing; run: npm run build -w packages/obsidian-plugin`
    );
  }
  copyFileSync(path.join(dist, f), path.join(pluginDir, f));
}
write(
  '.obsidian/plugins/foundry-ai-tool/data.json',
  JSON.stringify(
    { dashboardUrl: `http://localhost:${dashboardPort}`, theme: 'neutral', themeEnabled: false },
    null,
    2
  )
);
write('.obsidian/community-plugins.json', JSON.stringify(['foundry-ai-tool'], null, 2));
write('.obsidian/app.json', '{}');
write(
  '.obsidian/core-plugins.json',
  JSON.stringify(
    {
      'file-explorer': true,
      'global-search': true,
      graph: true,
      backlink: true,
      'command-palette': true,
      properties: true,
    },
    null,
    2
  )
);

// Library: 3 books, 12 notes each, every note links to its book note.
const books = [
  [
    'Test Bestiary',
    'Monsters',
    [
      'Grey Wolf',
      'Dire Rat',
      'Cave Troll',
      'Bog Wraith',
      'Ash Drake',
      'Stone Imp',
      'Mire Hag',
      'Pale Stag',
      'Ember Fox',
      'Moss Golem',
      'Night Crow',
      'Thorn Boar',
    ],
  ],
  [
    'Test Spellbook',
    'Spells',
    [
      'Spark',
      'Mend Cloth',
      'Fog Veil',
      'Ward Door',
      'Light Step',
      'Calm Beast',
      'Frost Ring',
      'Echo Call',
      'Stone Skin',
      'Glow Mark',
      'Ash Cloud',
      'Wind Knot',
    ],
  ],
  [
    'Test Armoury',
    'Items',
    [
      'Oak Shield',
      'Tin Helm',
      'Iron Pike',
      'Reed Bow',
      'Lantern',
      'Rope Coil',
      'Silver Ring',
      'Bone Flute',
      'Salt Pouch',
      'Mud Boots',
      'Glass Vial',
      'Wool Cloak',
    ],
  ],
];
for (const [book, kind, names] of books) {
  write(
    `Campaigns/${world}/AI Tool/Library/Books/${book}.md`,
    `---\ntype: library-book\n${MARK}\n---\n# ${book}\n\n${names.map(n => `- [[${n}]]`).join('\n')}\n`
  );
  for (const n of names) {
    write(
      `Campaigns/${world}/AI Tool/Library/${kind}/${book}/${n}.md`,
      `---\ntype: library-entry\nbook: ${book}\n${MARK}\n---\n# ${n}\n\nMade-up ${kind.toLowerCase()} entry. Book: [[${book}]].\n`
    );
  }
}

// World notes: an adventure hub, some journals, NPCs, a scene, linked to each other.
const journals = ['Arrival at the Ford', 'The Old Mill', 'Market Day', 'Night Watch'];
const npcs = ['Mara the Ferrywoman', 'Old Tobin', 'Sister Wren'];
write(
  `Campaigns/${world}/AI Tool/Foundry/Adventures/Test Adventure.md`,
  `---\ntype: adventure-hub\ngenerated_by: foundry-ai-tool\nadventure_folders:\n  - Test Adventure\n---\n# Test Adventure\n\n${[...journals, ...npcs, 'Ford Crossing'].map(n => `- [[${n}]]`).join('\n')}\n`
);
journals.forEach((n, i) =>
  write(
    `Campaigns/${world}/AI Tool/Foundry/Journals/Test Adventure/${n}.md`,
    `# ${n}\n\nMade-up journal page. Next: [[${journals[(i + 1) % journals.length]}]]. Present: [[${npcs[i % npcs.length]}]].\n`
  )
);
npcs.forEach(n =>
  write(
    `Campaigns/${world}/AI Tool/Foundry/Actors/${n}.md`,
    `# ${n}\n\nMade-up NPC. Seen at [[Ford Crossing]]. Fights like a [[Grey Wolf]].\n`
  )
);
write(
  `Campaigns/${world}/AI Tool/Foundry/Scenes/Ford Crossing.md`,
  `# Ford Crossing\n\nMade-up scene. See [[Arrival at the Ford]].\n`
);
write(
  'README.md',
  `# Small AI Tool test vault\n\nThrowaway vault for checking the plugin's graph commands. Made by scripts/test-env/small-obsidian-vault.mjs.\nAll text is made up. Open it with Obsidian's vault switcher (Open folder as vault).\n`
);

console.log(`Small test vault ready at ${root}`);
console.log(
  'Open it in Obsidian: vault switcher > Open folder as vault. Enable community plugins when asked.'
);
