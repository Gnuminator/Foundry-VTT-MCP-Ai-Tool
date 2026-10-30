// GM script (scripts/pi/remote/gm-script.sh, docs/dev/PI-SETUP.md "GM scripts"): the join page look for session 0
// (backlog join-page-look). Sets the world's Background Image to a file stage 19 (19-join-image.sh) put in the world's
// folder, and the World Description. Join Page Theme and Next Session stay as they are (Default, empty).
// The description is the text the user approved on 2026-10-30; Danni will send his own later: change DESC and dry-run again.
// No campaign art or book text is in this file. Undo: run it again with BEFORE_* values noted from the log (clear the
// background to fall back to the dnd5e image).
const WORLD = 'curse-of-strahd';
const IMAGE = `worlds/${WORLD}/join-background.webp`;
const DESC =
  '<h2>Session 0</h2><p>The mist has not lifted. Bring a character, bring a reason to stay, and bring a little courage.</p>' +
  '<ul><li>Remote, about three hours</li><li>We make the characters together</li><li>Headphones help, a quiet room helps more</li></ul>' +
  '<p>Sign in with the name your GM gave you. Stuck? Message Danni.</p>';

const src = game.world._source;
const before = {
  id: game.world.id,
  title: game.world.title,
  background: src.background ?? null,
  description: src.description ?? '',
  nextSession: src.nextSession ?? null,
  joinTheme: src.joinTheme ?? null,
};
args.log('before ' + JSON.stringify(before));
if (game.world.id !== WORLD) throw new Error('wrong world ' + game.world.id);

// The image must already be served (HEAD is a read, so a dry run does it too).
const head = await fetch(foundry.utils.getRoute(IMAGE), { method: 'HEAD' });
const imageBytes = Number(head.headers.get('content-length') ?? 0);
args.log(
  `image ${IMAGE}: HTTP ${head.status}, ${imageBytes} bytes, ${head.headers.get('content-type')}`
);
const plan = {
  background: IMAGE,
  descriptionLength: DESC.length,
  nextSession: 'unchanged',
  joinTheme: 'unchanged',
};

if (args.dryRun) return { dryRun: true, imagePresent: head.ok, plan, before };
if (!head.ok || !imageBytes)
  throw new Error('the image is not in the world folder: run stage 19 first');

const res = await fetch(foundry.utils.getRoute('setup'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'editWorld',
    id: WORLD,
    background: IMAGE,
    description: DESC,
    nextSession: before.nextSession,
    joinTheme: before.joinTheme,
  }),
});
const out = await res.json();
if (out.error) throw new Error('editWorld: ' + out.error);
const after = {
  title: out.title,
  background: out.background,
  description: out.description,
  nextSession: out.nextSession ?? null,
  joinTheme: out.joinTheme ?? null,
};
args.log('after ' + JSON.stringify(after));
// Foundry answers this POST with HTTP 401 for a GM-session cookie (seen on 14.369) yet saves and returns the world, so the
// answer's content is what counts.
if (after.background !== IMAGE || after.description !== DESC)
  throw new Error('editWorld did not take: ' + JSON.stringify(after));
if (
  after.title !== before.title ||
  after.joinTheme !== before.joinTheme ||
  after.nextSession !== before.nextSession
)
  throw new Error('editWorld changed a field it should have left alone: ' + JSON.stringify(after));
return { before, after };
