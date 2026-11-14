---
title: Game-night watch and guards
description: The game-night watch, the assistant GM hang watchdog, the crash guard and the clock sync.
---

# Game-night watch and guards

Part of [PI-SETUP](../PI-SETUP.md).

## Game-night watch (I-145)

`scripts/gamenight-watch.mjs` runs on this PC (nothing is installed on the Pi). Every minute it calls
Foundry's `/api/status` and posts to a Discord channel when Foundry does not answer, answers slowly, or
is back. One message when it goes down or slow, one when it recovers; a single miss or slow answer
posts nothing (defaults: 2 misses in a row for "down", 3 slow answers in a row for "slow", over 3 s;
2 good answers in a row for "back").

```powershell
node scripts/gamenight-watch.mjs --url http://<pi-address>:30000            # dry run: log only
node scripts/gamenight-watch.mjs --url http://<pi-address>:30000 --post     # post to Discord
```

Posting is opt-in (`--post`). It uses the bot token already in `%APPDATA%\foundry-ai-tool\discord-bot.env`
(never printed) plus `GAMENIGHT_WATCH_CHANNEL_ID=<channel>` in the same file, and optionally
`GAMENIGHT_WATCH_MENTION_IDS=<your id>,<GM id>` to ping you both. The bot must be in that server and
allowed to post in the channel. Another env file: `--env-files a.env,b.env` (comma separated, a later file wins; the old
`--env-file` still works but warns, because Node itself reads `--env-file` from the whole command line and stops on a
file it cannot open). Tune with `--interval`, `--slow-ms`, `--timeout-ms`, `--fail`, `--slow`,
`--recover`. For a test, point `--url` at the test server (`http://localhost:30001`) and stop it with
`scripts/test-env/stop.ps1 -Only foundry`.

The message names no address (the log line shows it without user name, password, query string or fragment). A message that Discord
refuses is kept and tried again at every check, so a short Discord outage does not lose the "down"
message; a late message says when the problem was noticed. With `--post` the watch first asks Discord
whether the bot can see the channel and stops with an error if not. Foundry counts as up only when
`/api/status` answers 200 with a running world (`active: true`); a redirect, the setup screen or a login
page counts as a miss. Use the Pi's own address (`http://<pi-address>:30000`): the players' Cloudflare
address is not checked. A Foundry that stays slow gets no second reminder, and a link that flaps posts a
down and back pair each time.

`--once` makes one check and exits with 1 if Foundry is not healthy or a post is unsent. One check
alone never posts "down" (it takes `--fail` misses in a row), so to test posting use
`--once --post --fail 1` against a stopped test server.

This PC copy only works while the PC is on and can reach the Pi. The same watch runs on the Pi itself as a
service with more checks: see [Game-night watch on the Pi (stage 29)](game-night-watch.md#game-night-watch-on-the-pi-stage-29).

## Clock sync (stage 18)

DietPi's default time sync (`CONFIG_NTP_MODE=2` in `/boot/dietpi.txt`) is "boot + daily": systemd-timesyncd
syncs once, then DietPi stops it again. `timedatectl` still says "System clock synchronized: yes" (the kernel
flag stays set for some hours) but "NTP service: inactive", and the clock drifts between syncs. Cloudflare Access tokens and
the board's hourly report need a correct clock. Stage 18 (`scripts/pi/remote/18-time-sync.sh`) sets DietPi's
mode 4 (daemon + drift) with `dietpi-set_software ntpd-mode 4`, so timesyncd stays enabled and running and a
later DietPi update keeps it. DietPi's tool also rewrites `/etc/systemd/timesyncd.conf` from `CONFIG_NTP_MIRROR` (default: removes it;
a hand edit would be lost, the snapshot has it). Nothing else is touched and nothing restarts.

- **Look first (changes nothing):** `cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'`
- **Run:** after a `dietpi-backup` snapshot and the user's OK,
  `cat scripts/pi/remote/lib.sh scripts/pi/remote/18-time-sync.sh | ssh foundry-pi 'bash -s'`.
  It ends by waiting (up to 90 seconds) for "NTP service: active" and "System clock synchronized: yes".
- **Check later:** `... | ssh foundry-pi 'CHECK=1 bash -s'` or `timedatectl`.
- **Undo:** the same pipe with `UNDO=1` (back to DietPi's mode 2).
- Tests: `scripts/pi/time-sync.test.mjs` (the stage in bash with stand-ins for systemctl, timedatectl and DietPi's tool).

## Assistant GM hang watchdog (stage 28)

A frozen Assistant GM page keeps its module socket for a while, so the 2 minute no-socket restart never sees it. The driver
(`scripts/pi/remote/assistant-gm.mjs`) now asks its own page for a trivial value every 15 s; a page that has not answered
within 10 s counts as silent, and 120 s of silence restarts the browser (the driver exits 1 and systemd, the Kit GM unit's `Restart=always`, Plan B's loop or Docker's
`restart: unless-stopped` starts it again). It is on for every caller of the driver, including the Kit GM and the Assistant GM during
stage 14's dnd5e migration; the 120 s and the cap of three restarts bound a slow migration, and stage 28 should not be applied during a trial. It has the same cap as the link check
(three restarts in six hours) but counts its own restarts in `page-restarts.json` in the browser profile, apart from the link check's `link-restarts.json`, so up to six restarts in six hours are possible under compose. It is on by default; `GM_PAGE_WATCH=0` turns it off. No module change.

- **Run it (a Pi sitting):** `scp scripts/pi/remote/assistant-gm.mjs foundry-pi:/root/`, then
  `cat lib.sh 28-gm-watchdog.sh | ssh foundry-pi 'bash -s'` (a dry run), a snapshot, the user's OK, the same with `APPLY=1`. The stage
  checks the new driver names `page-ping` and parses, keeps the old one as `assistant-gm.mjs.prev-<time>`, installs the new one,
  restarts the Assistant GM browser and reads back that it joined and, in the same run of the unit, logged `page watchdog armed`
  (a join without that line, such as `GM_PAGE_WATCH=0` in the unit, counts as a failure); a failed read-back puts the old driver
  back. `UNDO=1` puts the newest `.prev-*` back; when that file is the deployed driver already it changes and restarts nothing.
  The bridge link is down for the minute the browser takes to rejoin; Foundry is not restarted.
- **Compose:** the driver is baked into the `gm-browser` image, so the stage refuses there: when the unit is missing or disabled
  (the stage 24 cutover disables it and leaves the unit files, so "disabled" is the usual case) it says "rebuild the image";
  after a cutover the image rebuild (`pi-images.yml`) carries the watchdog. The line `was not running: left stopped` and the
  `Assistant GM is stopped, so the watchdog starts with its next start` line are not a pass: nothing was read back.
- Tests: `scripts/pi/gm-watchdog.test.mjs` (the ping decision, the real driver against a stand-in `playwright-core` whose page freezes,
  the stage as text; with `PI_GM_WATCHDOG_CONTAINER=1` the same plus the stage's scenarios in a Debian 13 ARM64 container, run by the
  ARM job in CI).
- **Pi run plan (not run yet):** (1) `deploy/pi/deployed-state.ps1` for the deployed driver's hash; (2) snapshot, the user's OK;
  (3) the dry run, then `APPLY=1`; the pass line is `joined the world again with the page watchdog on` (the stopped-unit line is not
  a pass); (4) the real-Chromium check (the container test uses a stand-in browser), only with the user's OK because it is a change
  outside a stage script and drops the bridge link. First read-only preconditions: `page-restarts.json` in the browser profile has
  fewer than 3 entries from the last 6 h (else the cap refuses the restart), the cgroup v2 file
  `/sys/fs/cgroup/system.slice/foundry-ai-tool-gm-browser.service/cgroup.procs` exists, and nobody is online. Freeze
  the Assistant GM's Chromium processes but not the driver, by pid from the unit's cgroup:
  `ssh foundry-pi 'main=$(systemctl show -p MainPID --value foundry-ai-tool-gm-browser.service); for p in $(cat /sys/fs/cgroup/system.slice/foundry-ai-tool-gm-browser.service/cgroup.procs); do [ "$p" = "$main" ] || kill -STOP "$p"; done'`;
  watch `journalctl -u foundry-ai-tool-gm-browser -f` for `the page has not answered a ping for 120 s; restarting the browser`
  and the rejoin, expected about 2.5 minutes after the freeze (the watchdog restarts the browser; the unit restart kills the frozen
  processes, nothing needs `kill -CONT`). If it does not come back, recover by hand first with
  `systemctl restart foundry-ai-tool-gm-browser` (ask for the user's OK: the guard hook does not ask for this command); (5) `UNDO=1`
  only if the browser still does not come back with the new driver.
- **Test environment:** the container scenarios run Debian 13's packaged `nodejs` (20.x) as a stand-in for the Pi's Node 24
  (`$NODE_DIR/bin/node` is a link to it), so they prove the stage and the driver's logic, not Node 24 behaviour; the frozen-page
  scenario prints the Node version it ran on.

## Game-night watch on the Pi (stage 29)

`scripts/pi/remote/29-gamenight-watch.sh` (backlog `watch-on-pi`) installs the watch as the service
`foundry-ai-tool-gamenight-watch` so the GM gets the `#gm-bot` alerts without the PC being on. It reuses the PC
watch's state machine and posting (`scripts/gamenight-watch.mjs`) through `scripts/gamenight-watch-pi.mjs`.

**When it runs:** the service is always on but idle. It asks the bridge every minute whether a play session is
marked (`get-play-session`, the same marker `mark-play-session` writes). While one is open it checks, every minute:

| Check          | How                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Foundry        | `/api/status` on the Pi answers 200 with a running world, slow over 3 s                            |
| Dashboard      | `/api/health` answers `ok` and `controlChannel: connected`                                         |
| Bridge link    | the bridge's `link_status` says the Foundry module socket is connected                             |
| Recorder       | the Discord bot's systemd unit is active, and (with stage 27) its status endpoint lists no problem |
| Public address | `/api/status` on the public address, with a Cloudflare Access service token; off until configured  |

It posts to `#gm-bot` when it starts ("Game-night watch started", with each check's first result), when a check
is down for 2 probes in a row, slow for 3 in a row, or back after 2 good ones, and when the session is marked
ended (2 closed readings in a row) or the service stops. A bridge that does not answer changes nothing about the
session (watch on stays on, off stays off), but the bridge check itself then reports. Posts hold no address, no
query string and no token; the log shows host names only.

A session that is still marked open but has had no event for 2 hours, with Foundry or the bridge link down (the 04:30
backup on a late night), raises no alarm and no start post. A session whose last event came between 02:30 and 04:30 is
not quiet yet at 04:30, so the backup can still raise an alarm that night. The end post reads "the session has ended or has gone quiet", because
nobody may have marked the end. A recorder check that cannot read `systemctl` as the `foundry` user counts as "cannot
tell" in the log, not as a down recorder. A settings problem (a bad number or address, no token, Discord refusing the
channel, or a public address on plain http while the Access token is set) exits 2 and the service stays stopped;
fix the file, then restart it. `set-discord-token.ps1` and stage 26 restart the watch for you (stage 26 also on a rerun
when its settings file is newer than the running watch) and warn when no "watching" line follows; stage 29 waits for
that line after a start or restart and fails when it never comes. A stop signal while a round runs waits for the round
and posts "the service is stopping" once.

**Install (user OK and a `dietpi-backup` snapshot first; never on a game night).** Step 1, read-only, before anything
else: check that the `foundry` user can ask systemd about the recorder, the way the watch does:

```bash
ssh foundry-pi 'runuser -u foundry -- systemctl is-active foundry-ai-tool-discord-bot.service; echo exit=$?'
```

`active`/exit 0 or `inactive`/exit 3 are both fine; anything else means the recorder check will report "cannot tell".

```bash
scp scripts/gamenight-watch.mjs scripts/gamenight-watch-pi.mjs foundry-pi:/root/
cat scripts/pi/remote/lib.sh scripts/pi/remote/29-gamenight-watch.sh | ssh foundry-pi 'DRY_RUN=1 bash -s'
cat scripts/pi/remote/lib.sh scripts/pi/remote/29-gamenight-watch.sh | ssh foundry-pi 'bash -s'
cat scripts/pi/remote/lib.sh scripts/pi/remote/29-gamenight-watch.sh | ssh foundry-pi 'CHECK=1 bash -s'
```

It needs stage 8 and 26 done (the bot token and `GAMENIGHT_WATCH_CHANNEL_ID` in `discord-bot.env`; it checks the names only).
It restarts nothing but itself. `UNDO=1` removes the service and the files and keeps the settings file.

The files come from the PC, not from the release build: copy them from a clean checkout of `main` at the merge commit. The stage
writes `SHA256SUMS` next to them (and `CHECK=1` prints it) so the hashes can be compared with
`git show aitool/main:scripts/gamenight-watch.mjs | sha256sum` and
`git show aitool/main:scripts/gamenight-watch-pi.mjs | sha256sum` (both files). A paper night (`mark-play-session` with `mode: "paper"`) is not
watched, because Foundry is closed on those. That needs a bridge build whose `get-play-session` reports `mode`; on an older bridge
a paper night would look like a live one and alarm, so run stage 5 with the release that has it before the first real session.

**The public check:** on the first run the stage creates `/etc/foundry-ai-tool/gamenight-watch.env`
(`root:foundry` 0640, every line commented out). To switch the public check on, the user (not Claude) adds
`WATCH_PUBLIC_URL`, `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` to it and restarts the service. The
Access application must allow that service token (policy "Service Auth") for the public address. The stage never
reads or prints the values. Other settings (ports, the recorder unit and status address, mention ids) are listed
in the template.

## Crash guard and clock check (stage 32)

`scripts/pi/remote/32-crash-guard.sh` (backlog `pi-crash-loops-clock`) makes a crash loop and a drifting clock visible.
Drop-ins `10-crash-guard.conf` on `foundry`, the bridge, the dashboard and the
Assistant GM browser (each only while it is an enabled systemd unit, not after a compose cut-over) set a start limit (Foundry 10 starts in 300 s, the Assistant GM browser 10 in 600 s, bridge and
dashboard 30 in 600 s), `RestartMode=direct` and `OnFailure=foundry-ai-tool-alert@%n.service`; Foundry also gets
`Restart=always`, so a clean exit no longer leaves it down. When a unit trips its limit, the alert unit (as `foundry`,
bot token from `discord-bot.env`) posts one fixed line to #gm-bot. A timer runs the clock check every 15 minutes: two
bad checks in a row post once, the first good one posts "synchronized again".

**A tripped unit stays down.** Before this stage a Foundry fault of a few minutes cleared by itself; now, after the limit,
Foundry stays failed until someone runs this over ssh (the alert text says so):

```bash
systemctl reset-failed foundry.service && systemctl start foundry.service
```

On game night with Foundry down, Plan B (`docs/dev/PLAN-B.md`) is the fallback while that is fixed. Systemd 257 also has
`RestartSteps=` and `RestartMaxDelaySec=` (a back-off that never gives up) if the user prefers that for Foundry.

The sitting, after the user's OK, on a day without a game: `DRY_RUN=1`, a `dietpi-backup` snapshot, the real run (it
restarts nothing, runs the clock service (the timer also fires once on enable) and posts one test line to #gm-bot, plus a
clock alert if the clock is not synchronized), then `CHECK=1`. `UNDO=1` removes
everything it installed.
