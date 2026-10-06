# Recording demo takes

Repeatable video takes and docs screenshots on the local test server (idea I-082). A take
is a short script: it resets a demo world to a saved clean state, opens visible browser
windows (Foundry as GM or player, the dashboard, the `/player` page), drives them
with Playwright, and records them with OBS Studio over its WebSocket. Running the same
take again gives the same video, so videos and screenshots are cheap to redo after a UI
change.

Test server only. Nothing here touches a real world or the live bridge ports 31414 to 31416. The test environment itself is described in
[`.claude/skills/foundry-test-env/SKILL.md`](../../.claude/skills/foundry-test-env/SKILL.md).

## What you need

- The local test server (`scripts/test-env/`), with the demo world `ai-tool-demo` and its
  snapshot (see [The demo world](#the-demo-world)).
- Microsoft Edge (ships with Windows). Playwright drives it through `playwright-core`; no
  browser download.
- OBS Studio 32 or newer: `winget install OBSProject.OBSStudio`.
- `ffprobe` on `PATH` (optional): the runner then prints the video's size and frame rate.
- Run the commands from PowerShell, not from a sandboxed shell: a sandbox can hide
  `%APPDATA%` (where OBS keeps its settings) and its windows cannot be captured.

## Record a take

```powershell
npm run demo:obs-setup
npm run demo:take -- damage-undo
```

`demo:obs-setup` is only needed once. It makes a WebSocket password, saves it in the
gitignored `scripts/demo/local.json`, writes it into OBS's WebSocket settings, starts OBS
and creates the profile and scene collection "Foundry AI Tool demo". `demo:take` also does
all of that when it is missing.

Options for `demo:take`:

| Option                                   | What it does                                                |
| ---------------------------------------- | ----------------------------------------------------------- |
| `--res 1080`, `--res 1440`, `--res 2160` | Output size. Default 2160. Always 60 fps, MP4 (never GIF).  |
| `--no-reset`                             | Skip the world reset; the demo world must already run.      |
| `--no-record`                            | Rehearse without OBS. Screenshots are still saved.          |
| `--keep-open`                            | Leave the browser windows open afterwards.                  |
| `--world <id>`                           | Another demo world (see [Private videos](#private-videos)). |

Every take writes a folder `C:\FoundryTest\demo\takes\<take>-<date>-<time>\`:

| File          | What it is                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `<take>.mp4`  | The recording (H.264, NVENC, Hybrid MP4).                                                                            |
| `steps.json`  | Each step with its start and end in seconds from the recording start.                                                |
| `take.json`   | Settings, the video's size and frame rate, screenshots, console errors per window, and the error if the take failed. |
| `shots/*.png` | Screenshots at 1920x1080 for docs.                                                                                   |

A screenshot of the window on air is not taken from the page while OBS records (Playwright's
`scale: 'css'` makes Chromium draw the page at 1x for a few frames, so the recording shows the
picture in the top-left quarter of the frame). The take notes the time and cuts the PNG out of
the finished video with ffmpeg instead; screenshots of other windows, and every screenshot of a
`--no-record` rehearsal, are real page screenshots.

`steps.json` is a plain list, for captions, chapters and a later voiceover:

```json
[
  {
    "step": "open-tool",
    "title": "Open plan-token-change in the Tool Runner",
    "start": 3.1,
    "end": 9.8
  }
]
```

A step also gets a `focus` box when a helper works on an element while that step runs
(`humanClick`, `humanHover`, `humanType`; the last one in the step wins). It is the element's
box as fractions of the recorded frame and the time in seconds from the recording start, for an
automatic zoom in the video editor:

```json
{
  "step": "ready",
  "start": 12.5,
  "end": 17.5,
  "focus": { "x": 0.026, "y": 0.275, "w": 0.087, "h": 0.036, "at": 13.6 }
}
```

A take can choose the element itself with `await t.focus(locator)` (it wins over the automatic
ones in that step). Only the window on air counts.

Takes stay out of the repo and the vault. Copy a screenshot into `docs/images/` by hand
when a page needs it, and only after the design pick (the screens will change before then).

## Export a take

```powershell
npm run demo:export -- damage-undo --clip open-tool..watch-undo
```

`demo:export` takes a take name (its newest recording) or a take folder, and writes into
that folder's `export\`:

| File               | What it is                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `<take>-1080p.mp4` | A 1080p60 copy of a 1440p or 2160p take (H.264, for uploads that want 1080p).                               |
| `<take>-clip.mp4`  | A 1080p60 clip of 10 MB or less, the limit for a video dragged into a README on GitHub.                     |
| `chapters.txt`     | YouTube chapters from `steps.json`: the first at 0:00, short steps merged so each lasts 10 seconds or more. |

`--clip a..b` picks the steps the clip covers (half a second either side), `--from` and
`--to` pick seconds instead, `--max-mb` changes the size limit and `--no-copy` skips the
1080p copy. It needs `ffmpeg` and `ffprobe` on `PATH`.

## How it works

### The demo world

`scripts/test-env/reset-demo-world.ps1` keeps a clean copy of three folders in
`C:\FoundryTest\demo\snapshot\` and puts them back before each take:

| Part                                                        | Folder                                           |
| ----------------------------------------------------------- | ------------------------------------------------ |
| Foundry world (scenes, actors, chat, users, world settings) | `C:\FoundryTest\data\Data\worlds\ai-tool-demo`   |
| Bridge vault (session log, guarded changes, undo data)      | `C:\FoundryTest\vault\ai-tool-demo`              |
| Test Obsidian notes for the world                           | `C:\FoundryTest\obsidian\Campaigns\ai-tool-demo` |

Once per PC, make the demo world and save its clean state:

```powershell
pwsh scripts/test-env/reset-demo-world.ps1 -Init -Start  # copy ai-tool-test to ai-tool-demo and start it
node scripts/demo/prepare-demo-world.mjs --as Claude      # tidy it (see below)
pwsh scripts/test-env/reset-demo-world.ps1 -Snapshot      # save it as the clean state
```

`prepare-demo-world.mjs` deletes chat, combats and the journals live tests leave behind,
keeps only a GM (renamed "GM") and "Player", and turns on "Allow Write Operations" and
"AI Tool: Handouts (writes)". It also adds invented prep content for the takes: a GM-only
"Letters" journal with a letter to reveal, a "Next session" journal, one quest (through
`create-quest-journal`) and a short recorded play session with one roll. It only runs in
`ai-tool-demo`, with Foundry, the bridge and the dashboard running. After that, every take restores the snapshot:

```powershell
pwsh scripts/test-env/reset-demo-world.ps1 -Start  # restore the clean state and start everything
```

The script only works on demo worlds (`ai-tool-demo`, or `ai-tool-demo-<name>` with
`-World`), only writes inside the test server's folders,
and refuses to stop Foundry while it runs another world (another session may be testing;
`-Force` overrides after you have asked). Service logs start empty on every start.

To change the clean state: start the demo world, change it in Foundry, then run
`-Snapshot`. Keep it to SRD or invented content: takes may become public videos.

### Private videos

A video only for your own table (a GM training cut, say) may show content that must never be
public, such as an adventure you bought. Keep everything about it off GitHub:

1. **A separate demo world**, copied from the world that holds the content, with Foundry
   stopped. Its id must start with `ai-tool-demo-`; the source world is only read:

   ```powershell
   pwsh scripts/test-env/reset-demo-world.ps1 -World ai-tool-demo-gm -Source my-content-world -Init -Start
   ```

   Tidy it in Foundry, then save its clean state with
   `reset-demo-world.ps1 -World ai-tool-demo-gm -Snapshot` (kept in
   `C:\FoundryTest\demo\snapshot-ai-tool-demo-gm`).

2. **Takes kept outside the repo**, in a folder of your own. Give `demo:take` the file's path
   instead of a name. The take gets the kit's helpers as `t.lib`, so it needs no imports
   from this folder:

   ```js
   export const meta = { title: 'Before the session' };
   export async function setup(t) {
     await t.foundry('Foundry', { user: 'Gamemaster' });
     await t.dashboard();
   }
   export async function run(t) {
     const { runPreflight } = t.lib;
     const dash = await t.scene('Dashboard');
     await t.step('preflight', 'Run the pre-flight check', () => runPreflight(dash.page));
   }
   ```

   ```powershell
   npm run demo:take -- C:\path\to\takes\before-session.mjs --world ai-tool-demo-gm
   ```

Recordings land in `C:\FoundryTest\demo\takes` as usual, outside the repo and the vault.

### Browser windows

`scripts/demo/lib/browser.mjs` opens each window as its own Edge app window (no tabs or
address bar) with a fresh profile, so no bookmarks, history or sign-ins show, and a GM
and a player can be logged in side by side. For a recording the window is fullscreen and
the page is laid out at 1920x1080 CSS pixels in its top-left corner, drawn at 1x, 1.333x
or 2x for 1080p, 1440p or 2160p. The layout is the same at every size; only the sharpness
changes. The window title is pinned (for example "Demo Dashboard") so OBS can find it, and
a smoothed blue dot shows the mouse, with a ripple ring where a click lands, since Playwright
never moves the real cursor (CSS only, so a take looks the same every run).

The same helpers work for checks without recording (the test kit can reuse them):
`openWindow` (default 1440x900, a size Foundry's canvas works with), `joinFoundry` and
`waitForCanvasReady` in `foundry.mjs`, the dashboard helpers in `dashboard.mjs`, and
`collectConsoleErrors`.

### OBS

`scripts/demo/lib/obs-setup.mjs` talks to OBS through the WebSocket client in `obs.mjs`
(protocol v5, no extra package). There is one scene per window: "Foundry", "Dashboard",
"Player page" and "Foundry player". Each one captures its window by title at 1:1 and
crops the capture to the page, so nothing is scaled. Desktop audio and the microphone are
muted: takes are silent and a voiceover comes later.

OBS 32 crashes when its video settings change while a window capture has been running,
and a resolution change over the WebSocket breaks recording until the profile loads
again. So a take never changes a running OBS: when the resolution or output settings
differ, it closes OBS, writes them into the profile's `basic.ini` and starts OBS again on
the demo profile. A take at the same resolution as the last one reuses the running OBS.

## Writing a take

A take is a file in `scripts/demo/takes/`. It exports `meta`, a `setup` that opens the
windows before the recording starts, and a `run` that is recorded:

```js
export const meta = { title: 'Plan a token move, apply it, undo it' };

export async function setup(t) {
  await t.foundry('Foundry', { user: DEMO_USERS.gm }); // join as the demo GM
  await t.dashboard(); // the dashboard
}

export async function run(t) {
  const dash = await t.scene('Dashboard'); // switch OBS and bring the window forward
  await t.step('open-tool', 'Open plan-token-change in the Tool Runner', async () => {
    await openToolForm(
      dash.page,
      'plan-token-change',
      { action: 'move', tokens: ['Wolf 1'], dx: 2 },
      { human: true }
    );
    await t.shot('Dashboard', 'tool-form'); // shots/tool-form.png
  });
}
```

`t.step` names a part of the take for `steps.json`; `t.pause(ms)` gives the viewer time to
read; `{ human: true }` moves the cursor to each control and types one character at a
time.

These takes ship with the repo. Videos should show what the dashboard does better than
Foundry's own UI (vault idea I-095):

- `handout-reveal`: the letter waits in the Handouts queue (setup queues it off camera).
  The GM reveals it after reading the confirm dialog, and it appears on the players'
  `/player` page.
- `preflight`: the Before view. Pre-flight checks the bridge, the module, the write switches
  and the players' page for spoilers; **Ready for session** turns on what tonight needs in one
  click; the GM ticks the manual checks; the feature cards say when to turn the rest on, and a
  card's **Read more** opens the guide in the side panel.
- `prep`: the Prep drawer shows the last session, the open quest, the "Next session"
  notes and what is ready, and opens the notes in Foundry.
- `damage-undo`: the During view. Setup starts a fight with Wolf 1, Wolf 2 and the Vampire
  (off camera). The GM selects the three in the turn-order strip, clicks **Damage / Heal**,
  types 14 necrotic and clicks once: it applies at once with an Undo message (D-086), and
  the Live Feed shows the Vampire's resistance worked out ("Vampire took 7 damage"). Then the
  HP drop in Foundry, Undo from Recent Changes (`undo-change`), and all three back to full HP.
- `after-stats`: the After view. Setup records a short play session with six real rolls (off
  camera); the take shows tonight's stats (rolls, most damage, the highest roll, who went
  down) and the "?" that opens the guide there.
- `token-move-undo` does plan, apply and undo with a token move (`plan-token-change`). It is
  the technical proof, not a video (nobody moves a token from the dashboard instead of
  dragging it), and it still uses the Tool Runner's confirm window.

Two more takes were made for the table demo (vault note "30-second table demo"):

- `table-player-attack`: logged in as Player, the hero (renamed "Brenna" for the video)
  attacks Wolf 2 from the character sheet. The dice are seeded, so every take rolls the
  same: 17 + 5 = 22 against AC 12, then 9 slashing. The GM applies the damage off camera, as
  at the table, and the dashboard's Live Feed shows the breakdown. The windows are laid out
  so the sheet, the tokens, the roll dialogs and the chat cards never overlap.
- `table-phone`: the players' `/player` page at a phone size (430x932 CSS pixels at 2x, in
  the top-left corner of the recording): the turn order with HP as words, then a Danish
  handout (invented text) that the GM reveals.

Foundry turns a random value r into `ceil((1 - r) * faces)`, so a seed of 0.17 rolls 17 on
a d20. Set the seed right before the click that rolls: dnd5e's roll dialogs draw random
values of their own when they open.

Every take keeps a GM logged in to Foundry in the background, even when its video shows
only the dashboard: the bridge reads and writes through that GM's Foundry window.

## Before a public video

The privacy checklist in the vault research note "Videos" applies: test server only,
Claude Desktop closed, no real names, no secrets on screen, SRD or invented content only,
and watch the raw take once before it goes anywhere.
