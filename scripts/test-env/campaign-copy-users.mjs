// Make every user of the campaign copy passwordless (the copy is a test server on localhost).
// Run with Foundry on the copy stopped:
//   node scripts/test-env/campaign-copy-users.mjs <foundry app folder> <world data folder>
// For example: <app>=C:\FoundryTest\app-14.370-official, <world>=C:\FoundryCampaign\data\Data\worlds\curse-of-strahd
// It reads and writes only the world's `users` LevelDB inside the copy. Prints user names and roles,
// never password values.
import { createRequire } from 'node:module';
import path from 'node:path';

const [appDir, worldDir] = process.argv.slice(2);
if (!appDir || !worldDir) {
  console.error('usage: campaign-copy-users.mjs <foundry app folder> <world folder>');
  process.exit(2);
}
const require = createRequire(path.join(appDir, 'package.json'));
const { ClassicLevel } = require('classic-level');

const db = new ClassicLevel(path.join(worldDir, 'data', 'users'), { keyEncoding: 'utf8', valueEncoding: 'utf8' });
await db.open();
// Foundry stores "no password" as the hash of the empty string with the user's salt (an empty
// string would mean "wrong password"). This pair is the one a passwordless user has on the test
// servers (read from the "Claude" user of server A); it is not a secret.
const EMPTY_PASSWORD = {
  password: '11a9c84ba8c7103b95d9ac3dcf43b35d388f9def69802b977a77fca2fd90a0d4ea81d9c8075aa218a467de0356dd5bbde307cfb8461c8fbace948084432d7271',
  passwordSalt: '0402a6847ee45a113e586ec100be6c0e322eea5ea3c84146aa30a54a29fc3723',
};
let changed = 0;
for await (const [key, value] of db.iterator()) {
  if (!key.startsWith('!users!')) continue;
  const user = JSON.parse(value);
  const already = user.password === EMPTY_PASSWORD.password && user.passwordSalt === EMPTY_PASSWORD.passwordSalt;
  if (!already) {
    Object.assign(user, EMPTY_PASSWORD);
    await db.put(key, JSON.stringify(user));
    changed += 1;
  }
  console.log(`${user.name} (role ${user.role})${already ? ': already passwordless' : ': password cleared'}`);
}
await db.close();
console.log(`${changed} user(s) changed.`);
