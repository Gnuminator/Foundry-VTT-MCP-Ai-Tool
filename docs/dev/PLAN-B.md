# Plan B: the Pi is down on game night

If the Orange Pi dies on game night, you run Foundry on your own PC from last night's backup and
the players reach it through a spare tunnel (decision D-097, item 6). This page has the steps for
you. The GM's side (what Danni sees and does) is in the
[game night runbook](../gm/game-night-runbook.md#the-server-is-down).

What you get: the Curse of Strahd world as it was at the Pi's last nightly backup (04:30), with
the same users and passwords, the same modules and maps, the bridge, the dashboard and the
Assistant GM. What is lost: everything played on the Pi after that backup. The GM sets hit points,
spell slots and items back by hand.

Measured on this PC (2026-10-09): restoring the backup takes about 30 seconds, starting everything
about one minute. Budget 15 minutes for the whole switch, including telling the players.

## What it touches

Everything lives in `C:\FoundryPlanB`. The scripts never write to the test server
(`C:\FoundryTest`, only its licence file is read once), never contact the Pi except to check that it
is down, and read the backup copies in `E:\PiBackup\restic` without locking them.

| Folder                       | What                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `C:\FoundryPlanB\app`        | Foundry itself, the same version as on the Pi                           |
| `C:\FoundryPlanB\data`       | Foundry's data: worlds, modules, maps from the backup; its own settings |
| `C:\FoundryPlanB\tool`       | The bridge vault (change history) and the dashboard state               |
| `C:\FoundryPlanB\secrets`    | The Assistant GM login from the backup, readable by you only            |
| `C:\FoundryPlanB\logs`       | One log per service                                                     |
| `C:\FoundryPlanB\state.json` | What was restored and started                                           |

Two port sets:

| Mode                      | Foundry | Bridge control | Foundry link | Dashboard |
| ------------------------- | ------- | -------------- | ------------ | --------- |
| Rehearsal (the default)   | 30100   | 31614          | 31615        | 3300      |
| Game night (`-GameNight`) | 30000   | 31414          | 31415        | 3000      |

Game night uses the Pi's own ports, so the world, the module and the tunnel need no changes.
`start.ps1 -GameNight` refuses while the Pi's Foundry still answers, on Tailscale or on the home
network: two copies of the world must never run at once. There is no switch past that: unplug the
Pi. The check needs this PC's Tailscale connected (away from home it is the only way to see the
Pi); with Tailscale off, unplug the Pi and add `-PiUnplugged`. Every start refuses a port that is taken, or one that belongs to the test server
(30001, 31514 to 31516, 3100) or the project dashboard (3200). The game-night ports include the
live bridge ports 31414 and 31415, an exception to the PC rule that the user granted for
`-GameNight` only (2026-10-09).

**Licence:** Plan B uses the test server's licence file (one key may run several test servers at
once). Real players never join the test server, and they join Plan B only on a game night
(`-GameNight`). A rehearsal is for you alone, so it may run beside the test server.

## Ready in advance (once, and after each Pi update)

- [ ] The daily backup copy runs: `E:\PiBackup\restic-last-success.txt` shows today or yesterday
      (task "Foundry Pi restic copy", [Orange Pi setup](PI-SETUP.md#restic-copies-on-this-pc)).
- [ ] The restic password is in your password manager (Waiting item 11).
- [ ] Node.js 24 is installed (Foundry 14 needs it) and restic (`winget install restic.restic`).
- [ ] The repo's main checkout is built (`npm ci`, `npm run build`): Plan B runs the bridge and the
      dashboard from it.
- [ ] Foundry's zip for the Pi's version is in `Downloads` (today `FoundryVTT-Node-14.368.zip`).
      **After every Foundry update on the Pi, download the new version's Node.js zip too.**
      `restore.ps1` installs it when the world needs it, and refuses a mismatch: a newer Foundry
      would migrate the world so the Pi could not open it again.
- [ ] One rehearsal (below) since the last Pi update.
- [ ] The spare tunnel, once Part C is live (below).

## On the night

Open PowerShell 7 in the repo's main checkout.

1. **Is the Pi really down?** Open the game's address yourself. Try one power cycle of the Pi (pull
   the plug, wait 10 seconds, plug in, wait 3 minutes). If Foundry is not back, **unplug the Pi and
   leave it unplugged for the night**, so it cannot come back halfway through and run the old world
   beside Plan B. Tell the GM to announce a 15-minute break.
2. **Restore last night's backup:**

   ```powershell
   .\scripts\plan-b\restore.ps1
   ```

   It names the backup it uses and its age. Older than a day and a half means the backups had
   stopped: you continue from an older point, tell the GM.

3. **Start everything:**

   ```powershell
   .\scripts\plan-b\start.ps1 -GameNight -Tunnel -PublicHost plan-b.<domain>
   ```

   Without the spare tunnel (Part C not live yet, or an in-person night): leave out `-Tunnel` and
   `-PublicHost`.

4. **Check:**

   ```powershell
   .\scripts\plan-b\check.ps1
   ```

   It ends with "Plan B is up." or names each problem and what to do.

5. **Tell the players.** Post the address in Discord: `https://plan-b.<domain>` (remote), or
   `http://<your PC's address>:30000` at the table on your home network (`ipconfig` shows the
   address; Windows asks once whether Node.js may use private networks: allow it). Same user
   names and passwords as always.
6. **Claude for you (optional).** Your Claude Desktop connectors point at the Pi. To point them at
   Plan B: `.\scripts\plan-b\connectors.ps1 -To planb`, then quit Claude Desktop from the tray icon
   and start it again (this also ends any Claude Code session in the app). The GM's own Claude
   (D-095) does not reach Plan B; the GM plays by hand.

The dashboard runs at `http://localhost:3000` on your PC only. The GM does not get it on a Plan B
night; changes made by hand in Foundry need no dashboard.

## After the night

1. **Stop:** `.\scripts\plan-b\stop.ps1`. The data stays.
2. **Claude back to the Pi:** `.\scripts\plan-b\connectors.ps1 -To pi`, then restart Claude Desktop.
3. **The world goes back to the Pi before anyone plays there again.** Otherwise the Pi starts from
   its old backup and the Plan B night is lost. Until it is back, tell the players not to use the
   Pi's address. First build and check the bundle on your PC (nothing goes to the Pi):

   ```powershell
   .\scripts\plan-b\push-back.ps1
   ```

   It refuses while Plan B still runs (run `stop.ps1` first) and when the copy was never played on
   a game night. The rest is a Pi change, so a session does it after your OK (the Pi rule in
   CLAUDE.md): it takes a `dietpi-backup 1` snapshot, runs `push-back.ps1 -Upload`, and then runs
   the stage 11 command that prints (`REPLACE_WORLD=1 KIT_WORLD=`: the Pi's world is replaced, the
   kit world is left for the next normal push). Foundry on the Pi stops for a few minutes.
   **Rule for the push-back:** it refuses when the Pi's world changed after the backup Plan B
   restored (`snapshot.time` in `C:\FoundryPlanB\state.json`). Someone may have played or prepared
   on the Pi after it came back, and that work would be lost. Stage 11 then lists up to five of the
   changed documents (collection, name, time) and replaces nothing. Expect it often: the Pi usually
   runs for some hours after its 04:30 backup, and the GM's prep through the AI tools counts. You
   decide: only with your OK does the session run it again with `REPLACE_NEWER=1`. Starting the
   world alone changes nothing (measured 2026-10-09: Foundry started, the Assistant GM joined and
   the bridge linked, and none of the world's 11,032 documents changed), so the list shows real
   work; a module added later that writes a setting at start could show up too. A document that
   was only deleted on the Pi leaves no trace and is not seen. The Pi's old copy is kept in
   `/var/lib/foundry-import/prev-<time>` either way.

4. **Clean up once the world is back on the Pi:** `.\scripts\plan-b\stop.ps1 -Clean -PushedBack`.
   It keeps Foundry and the licence for next time. Without `-PushedBack` it refuses to delete a
   world a night was played on.

## Rehearsal

A rehearsal never touches the Pi, the test server or Claude Desktop. It uses the rehearsal ports,
so it can run while the Pi and the test server run.

```powershell
.\scripts\plan-b\restore.ps1
.\scripts\plan-b\start.ps1
.\scripts\plan-b\check.ps1
# open http://localhost:30100 and log in as a player: the world, the maps and the characters are there
.\scripts\plan-b\stop.ps1 -Clean
```

The full rehearsal before the first online night (G2) also tests the tunnel with a phone off
Wi-Fi. It keeps the rehearsal ports and uses the tunnel's rehearsal route, so the Pi keeps running:
`start.ps1 -Tunnel -PublicHost plan-b-test.<domain>`, log in from the phone at
`https://plan-b-test.<domain>`, then `stop.ps1 -Clean`. The game-night route (`plan-b`, port 30000)
is the same tunnel; only the port differs.

## Spare tunnel (finished once Part C is live)

> **Not set up yet.** This step needs your domain in Cloudflare (Waiting item 13, Part C in
> [Remote access](REMOTE-ACCESS.md#part-c-players-and-the-gm-reach-the-orange-pi-through-cloudflare)).
> Until then Plan B works for players on your home network only.

A second Cloudflare tunnel, `foundry-pc`, runs on your PC only while Plan B runs. It has its own
names, so on the night nothing in Cloudflare has to change: `plan-b` reaches the game-night port,
`plan-b-test` the rehearsal port.

1. **The tunnel.** Zero Trust, Networks, Connectors, Create a tunnel, type `Cloudflared`, name it
   `foundry-pc`, pick Windows and 64-bit. **Do not run the command it shows** (it would install an
   always-on Windows service). Leave the page open.
2. **Its names.** In that tunnel add two published application routes, service `HTTP` each:
   subdomain `plan-b`, URL `localhost:30000` (game night), and subdomain `plan-b-test`, URL
   `localhost:30100` (rehearsal). As for the Pi, never set "HTTP Host Header".
3. **Who may open them.** Zero Trust, Access controls, Applications, `Foundry players`: add
   `plan-b.<domain>` and `plan-b-test.<domain>` as more domains of the same application, so the
   same people get in.
4. **cloudflared on this PC:** `winget install Cloudflare.cloudflared`.
5. **The token (you, in your own PowerShell window; Claude never sees it):**

   ```powershell
   .\scripts\plan-b\set-tunnel-token.ps1
   ```

   Paste the token or the whole install command from the tunnel page. It is saved encrypted for
   your Windows user on this PC.

6. **Test it** with the full rehearsal above. Players may need a new email code on the first
   visit to `plan-b.<domain>`.

## If something goes wrong

| Problem                                        | What to do                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restore.ps1`: not a restic repository         | Drive E: is not connected, or the copy task never ran.                                                                                            |
| `restore.ps1`: Foundry x is needed             | Download that version's Node.js zip from foundryvtt.com and give it with `-FoundryZip`.                                                           |
| `start.ps1`: REFUSED, a port is in use         | The line names the port. Close what holds it, or (rehearsal only) stop the test server.                                                           |
| `start.ps1`: REFUSED, the Pi's Foundry answers | The Pi is up. If it is up but broken, unplug it and start again.                                                                                  |
| `start.ps1`: REFUSED, Tailscale not connected  | Connect Tailscale on this PC (tray icon) and start again. Or unplug the Pi and add `-PiUnplugged`.                                                |
| Foundry asks for a licence key                 | The licence file is missing: copy `C:\FoundryTest\data\Config\license.json` to `C:\FoundryPlanB\data\Config`.                                     |
| `check.ps1`: module link down after 2 minutes  | See `C:\FoundryPlanB\logs\assistant-gm.out.log`. Or log in to Foundry as the Gamemaster in a browser on your PC: the module there holds the link. |
| Players get a Cloudflare error                 | `check.ps1` shows whether the tunnel is connected; see `C:\FoundryPlanB\logs\tunnel.err.log`.                                                     |

The scripts are in `scripts/plan-b/` and say more in their own help (`Get-Help .\scripts\plan-b\start.ps1 -Full`).
