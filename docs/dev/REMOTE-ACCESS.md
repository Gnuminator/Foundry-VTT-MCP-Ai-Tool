# Remote Access: Operational Setup Guide

> **Status:** Part C below (the Orange Pi through Cloudflare) was set up for real on 2026-10-14
> and is the tested path. After it comes the "Settings reference" for the variables that make each
> hop config-driven. The older scaffold for a locally managed tunnel (never run) moved to
> [docs/history/REMOTE-ACCESS-SCAFFOLD.md](../history/REMOTE-ACCESS-SCAFFOLD.md).
>
> **What stays out of this repo:** email addresses, Cloudflare account and tunnel ids, tokens
> and Access AUD tags. Public hostnames appear here and in a few scripts as examples; they sit
> behind Cloudflare Access.
>
> For the big-picture roadmap that Phase 6 fits into, see `docs/history/PHASE6-DESIGN.md`
> (written in parallel). For the existing Windows-local deployment, see `docs/dev/DEPLOYMENT.md`
> and `deploy/windows/`.

---

## Part C: players and the GM reach the Orange Pi through Cloudflare

This is the real plan for the Orange Pi (decision D-075). It replaced the older scaffold (now in
`docs/history`): the tunnel is a **remotely managed tunnel**, so the Pi holds only a token and every hostname and
every login rule lives in the Cloudflare dashboard. Nothing is opened on your router, and the
players install nothing: they open a web address and confirm their email with a code about once a
month.

What goes through the tunnel, and nothing else:

| Public name              | Goes to on the Pi                                      | Access application and policies                                                                                                              |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `play.<domain>`          | Foundry, `localhost:30000`                             | Self-hosted application, 730 h session. Policies: allow by email (the players, the GM and you) and one service token (the game-night watch)  |
| `cogm.<domain>`          | Dashboard, `localhost:3000`                            | Self-hosted, 730 h. Allow by email (GMs and players; the players see `/player`) and one service token (the Obsidian plugin)                  |
| `mcp.<domain>`           | Bridge control port, `tcp://localhost:31414`           | Self-hosted, one-hour session. Allow by email (the GMs) and service tokens (the GM's and your Claude Desktop). See "The GM's Claude Desktop" |
| `player-ai.<domain>`     | Dashboard, `localhost:3000` (`/mcp/player`)            | Self-hosted, Service Auth only: one service token per player, never an email login                                                           |
| `player-remote.<domain>` | Dashboard, `localhost:3000`                            | Self-hosted with Managed OAuth and the players' email policy (the Claude custom connector)                                                   |
| `board.<domain>`         | Not on the tunnel: the PM board is on Cloudflare Pages | Self-hosted. Allow by email (the board owner, the GMs, the players) and service tokens (board MCP, Pi status); one path has its own policy   |

The five GM web connectors, when deployed, add one more application with Managed OAuth and the GM
email policy only (see "The GM remote connector"). The live state is checked against a saved copy
with the `cloudflare-work` skill's drift check.

### Edge rules (Cloudflare Transform Rules)

Two rules on the `play.<domain>` host let the GM page (`/gm`) show Foundry inside a frame. Foundry
14 sends `X-Frame-Options: DENY`, so a browser refuses to put it in a frame.

1. **Modify Response Header:** removes `X-Frame-Options` and sets `Content-Security-Policy` to
   `frame-ancestors https://cogm.<domain>` (Set, not Add: Foundry sends no policy of its own).
2. **Modify Request Header:** removes the `Sec-Fetch-Dest` header from the request.

Without them the GM page's Live frame stays blank. A rebuild of the Cloudflare setup from this
guide must add both. If a later Foundry sends its own `Content-Security-Policy`, merge its
directives into the rule's value; with two policies the browser enforces both.

The module port (31415), SSH, Syncthing and the Assistant GM browser are never published. The control
port 31414 has no login of its own, so it is published only behind the Access application of the
`mcp` name, never as an open route (D-095).
Tailscale stays for your own admin access. Foundry's own login (a user per player, as today) still
applies behind Access: Access decides who may reach the page, Foundry decides who they are.

Pick the names yourself; `play` and `cogm` are examples, any name works (the Pi's real Foundry name is
different). Below, `<domain>` is your domain and `play.<domain>` is whatever name you chose for
Foundry.

Cloudflare renamed its Zero Trust dashboard to **Cloudflare One** (`one.dash.cloudflare.com`), and
the menus move now and then. The paths in steps 1 to 5 were walked on 2026-10-14; the service token path in step 11 and the Revoke path under "Removing a
player" were not walked and may have moved. If a name has changed, look for the same word nearby.

### What you do

1. **Domain.** In the Cloudflare dashboard (`dash.cloudflare.com`) buy a domain under Domain
   Registration, or add one you own and point its nameservers at Cloudflare as the page tells you.
2. **Team and the login method.** Open Cloudflare One (`one.dash.cloudflare.com`) and pick a team
   name when asked (you need it in step 5). The free plan covers up to 50 people. Cloudflare may ask
   for a payment method even for the free plan; that is yours to enter. Then switch on the email
   code login, which new accounts do not have: Integrations, Identity providers, Add an identity
   provider, **One-time PIN**, Save. Without it the Access application in step 4 has no way to let
   anyone in.
3. **Tunnel.** Networks, Connectors (or Tunnels), Create a tunnel, type `Cloudflared`, name it
   `foundry-pi`. On the next page pick Debian and 64-bit ARM. **Do not run the command it shows.**
   It contains the token (the long text after `install`). Leave the page open: you copy the token in
   step 8. Never paste the token into a chat, a file in the repo or the vault. The tunnel says
   Inactive until the Pi connects in step 8; that is expected.
4. **Who may open Foundry (do this before the name exists).** Access controls, Applications, Add an
   application, Self-hosted. Name `Foundry players`, domain `play.<domain>`, session duration 730
   hours (what the live application uses). Add a policy named `Players`: action Allow, include Emails, then the email of each player,
   the GM and you. Make it a reusable policy (the dashboard application in step 10 uses it too).
   Under login methods keep only One-time PIN. Choose the **Instant auth** setting now and use the same one for the dashboard application in step 10. Save. Players will get a code by
   email the first time and about once a month after. Open the saved application and copy its
   **Application Audience (AUD) Tag**; you need it in step 5.
5. **The Foundry name.** Back in the tunnel, Published application routes (or Public hostname),
   add: subdomain `play`, your domain, service type `HTTP`, URL `http://localhost:30000` (keep the
   `http://`; the bare `localhost:30000` does not work). Leave every option under Additional
   settings as it is (WebSockets work by default); in particular **never set "HTTP Host Header"**,
   because the dashboard's host check (a `421` for names it does not know) is what keeps an
   unconfigured name closed. Save the route.

   One option is worth setting: **Validate the Access JWT at the tunnel** (under Access in the
   route's additional settings). The tunnel then refuses any request that did not come through
   your Access application, so a name that someone points at the tunnel by another path stays
   shut. It asks for your **team name** (step 2) and the **AUD tag** of the `Foundry players`
   application (step 4), not the AUD tag of another application. Save the route again. A wrong
   AUD tag (or team name) shows up as a **403** right after the email code (the login worked, the
   tunnel turned the request down): copy the AUD tag again from the application, check the team
   name and save the route.

6. **Pi: install the tunnel and Foundry's public name (Claude, with your OK).** Claude takes a
   `dietpi-backup 1` snapshot, then runs stage 12 (`12-tunnel.sh`, see [Orange Pi setup](PI-SETUP.md))
   once with `FOUNDRY_PUBLIC_HOST=play.<domain>`: one snapshot, one run, and it sets Foundry's public
   name in the same pass (step 7). It installs Cloudflare's `cloudflared` from Cloudflare's own
   signed package source and sets it up as a service that stays off until the token is there. Before
   anything else it checks two things and stops while either fails, because anyone past Cloudflare
   Access reaches what is behind them:
   - **Foundry's administrator password** is set (without it `/setup` is open, and anyone could
     launch, delete or reinstall worlds). Set it on Foundry's setup screen: the Configure gear
     (Application Configuration), Administrator Password (the button reads Change Password once one is set).
   - **Every world's Gamemaster and Assistant GM users have a password** (anyone could pick such a
     user on the join page). A world with no Gamemaster at all counts too, for example a world that
     was never launched: its next launch makes a "Gamemaster" with no password. The stage names the
     world and the user; set a password in that world (Game Settings, User Management), or launch
     the world once and set the new Gamemaster's password, or remove a world nobody uses. Then run
     the stage again.

   Stage 12 checks only when it runs. **Run the check again after adding or resetting a world or
   adding a GM user** once the tunnel is open. Claude runs it on its own at any time; it changes
   nothing:
   `cat scripts/pi/remote/lib.sh scripts/pi/remote/lib-gm-passwords.sh scripts/pi/remote/gm-passwords.sh | ssh foundry-pi 'bash -s'`.

7. **What `FOUNDRY_PUBLIC_HOST` does.** It sets three Foundry options so invitation links and audio
   and video use the public name: `hostname` = `play.<domain>`, `proxySSL` = true, `proxyPort` =
   443 (the old `options.json` is kept beside it as `options.json.before-tunnel.<time>`). Foundry
   restarts for a moment and opens its world again by itself, from `options.json`; the stage does
   not launch the world. The stage can also be run
   first without the variable and a second time with it, but that costs a second snapshot and run
   for nothing.
8. **Pi: the token (you, in your own SSH session).** Claude never types or sees it. In PowerShell on
   this PC, from the repo folder:

   ```powershell
   scp scripts\pi\remote\lib.sh scripts\pi\remote\set-tunnel-token.sh foundry-pi:/tmp/
   ssh -t foundry-pi bash /tmp/set-tunnel-token.sh
   ```

   It asks for the token without showing it. Copy it from the Cloudflare tunnel page (or the whole
   install command, it picks out the token) and paste, then Enter. It saves the token in a file only
   root can read and starts the tunnel; it ends with "connected to Cloudflare". In the Cloudflare
   dashboard the tunnel now says Healthy. Restarting a running tunnel cuts the players off, so the
   script refuses while players are online in Foundry or a recording runs; `FORCE=1` in front of
   `bash` (`ssh -t foundry-pi FORCE=1 bash /tmp/set-tunnel-token.sh`) goes on anyway.

9. **Test from a phone off Wi-Fi.** Switch the phone to mobile data and open `https://play.<domain>`.
   Expected: a Cloudflare page asking for an email; an address not on the policy gets no code; an
   address on it gets a code by email, then Foundry's join page. While the world has no player
   users yet, seeing the join page with its user list is the test. The player users exist since 2026-10-18
   (`Ask`, `David`, `Sebastian`, Player role, no password: Access is the lock since the router
   forward went, D-065 trust model). Also log in as one and move a token, which proves WebSockets
   work. A **403** after the code is a wrong AUD tag or team name on the route (step 5). Test with one
   player's real address before telling the others.
10. **The dashboard, for the GM. The order matters: Access first, the name last.** The
    dashboard checks Cloudflare's signed login token (idea I-022, built) and, once it has GM
    emails, shows everyone else the read-only player view. Until the Access application exists
    that view would be open to the internet, so the `cogm` name is added last. The three parts are
    under "Step 10 in detail" below.
11. **Service token for the GM's Obsidian plugin (D-094).** Cloudflare One, Access controls, Service
    credentials, Service Tokens, Create. Name it `obsidian-gm-plugin`, duration 1 year. Copy the
    Client ID and Client Secret now: Cloudflare shows the secret **once**. If it is lost, open the
    token and choose **Rotate**, which makes a new secret. Cloudflare's copy
    buttons copy the header name too (`CF-Access-Client-Id: ...`, `CF-Access-Client-Secret: ...`);
    the plugin accepts that, but [the GM's vault guide](../gm/obsidian.md) says to paste only the
    value. On the `Foundry dashboard`
    application add a further policy named `Obsidian plugin` with action **Service Auth** and
    include Service Token, that token. Do not add it to the `Foundry players` application: it must
    reach the dashboard name only. The Client ID and Secret go into the plugin's settings on the
    GM's PC (Obsidian's secret storage; steps in [the GM's vault guide](../gm/obsidian.md)), never
    into the vault or the repo. It expires after one year (Cloudflare emails a warning first); to
    revoke it earlier, delete it under Service Tokens or remove the `Obsidian plugin` policy. A
    service token's login carries no email, so it only gets the plugin through Cloudflare; the GM
    role comes from the dashboard's GM token (`GM_DASHBOARD_TOKEN`, set by
    `set-dashboard-access.sh`), which the GM also puts into the plugin (the user's pick,
    2026-10-06). No dashboard change is needed.

### Step 10 in detail: the dashboard for the GM

Do these in order. Nothing here is done by ad hoc commands: the Pi changes come from reviewed
scripts, and the two that touch secrets are run by you.

1. **Access application first.** In Cloudflare create the Access application `Foundry dashboard`
   for `cogm.<domain>` with two Allow policies. One is for the GMs: include only the GM's and your
   email (a reusable policy, here `Dashboard GMs`, keeps the list in one place). The other is the
   players' policy from step 4 (`Players`, saved as reusable, or a copy of it): the players get the
   dashboard's read-only `/player` view, and only the emails in `GM_EMAILS` (part 2 below) get the
   GM role. Under login methods keep only One-time PIN. **Instant auth:** the `Foundry players`
   application from step 4 may have it off while this one has it on (it skips Cloudflare's own
   login page when One-time PIN is the only method); choose one setting for both so the two names
   behave the same. Save, open the application and copy its **Application Audience (AUD) Tag**. Do
   not add the `cogm` route yet.

   No stage 5 rerun is needed: stage 5 already put the line into the dashboard's service that reads
   `/etc/foundry-ai-tool/dashboard-access.env`, so the file you make in part 2 is read at the
   dashboard's next restart, which the script does. Only if the script refuses with "the dashboard service does not read ... yet" (a Pi
   on a stage 5 build from before that line), take a `dietpi-backup 1` snapshot and ask Claude to run
   stage 5 once more, with `TOOL_REF` set to the contents of `/opt/foundry-ai-tool/app/.tool-ref` so it
   does not build another version.

2. **The access settings (you, in your own SSH session).** Claude does not type these. From the
   repo folder in PowerShell:

   ```powershell
   scp scripts\pi\remote\lib.sh scripts\pi\remote\set-dashboard-access.sh foundry-pi:/tmp/
   ssh -t foundry-pi bash /tmp/set-dashboard-access.sh
   ```

   Restarting a running dashboard drops the pages that are open, so the script refuses while
   players are online in Foundry or a recording runs; `FORCE=1` in front of `bash` goes on anyway
   (`ssh -t foundry-pi FORCE=1 bash /tmp/set-dashboard-access.sh`).

   It asks for your Cloudflare team name, the AUD tag from part 1, the GM's and your emails, and
   the `cogm.<domain>` name, and reads the Pi's Tailscale name by itself. It checks every answer,
   makes the GM token, writes `/etc/foundry-ai-tool/dashboard-access.env` (root, group `foundry`,
   0640), restarts the dashboard and prints the GM's one-time link on your screen only. Why a file
   of its own: stage 7 rewrites `dashboard.env` whole, which would drop these settings. The file's
   `DASHBOARD_ALLOWED_HOSTS` replaces the service's own, so it lists both `<tailscale name>` and
   `cogm.<domain>`; the script does that. Over Tailscale the GM has no Cloudflare login, so with
   the split on he would see the player view; the token fixes that. That link is only for the
   Tailscale route: the GM needs Tailscale on the device that opens it, and does not need the link
   at all for `cogm.<domain>`, where the Cloudflare login and `GM_EMAILS` already make him GM. Give
   him the link (outside the repo and the vault) if he wants the Tailscale route: he opens
   `http://<tailscale name>:3000/?token=<token>` once, the browser
   remembers the token and removes it from the address bar. The browser's history may still list
   that first visit, so he should open the link in a private window, or delete that one history
   entry afterwards. The same token is the **GM token** the Obsidian plugin needs
   ([the GM's vault guide](../gm/obsidian.md)). Run the script again to change an
   answer; add `--rotate-token` for a new token (the GM then opens the new link once).

3. **The name last.** In the tunnel, Published application routes, add subdomain `cogm`, service
   `HTTP`, URL `http://localhost:3000` (again no "HTTP Host Header"; set "Validate the Access JWT
   at the tunnel" here too, with your team name and the AUD tag of the `Foundry dashboard`
   application from part 1). Test: `https://cogm.<domain>` must
   ask for a Cloudflare login. Only the GM emails reach the dashboard as GM; a player's email gets
   the read-only player view.

4. **Portraits in the initiative ribbon.** The ribbon loads each token portrait from Foundry, so the
   dashboard must know Foundry's address _as the GM's browser reaches it_: run stage 7 again with
   `DASHBOARD_FOUNDRY_URL=https://play.<domain>` (a plain address, no path and no trailing slash;
   `... | ssh foundry-pi 'DASHBOARD_FOUNDRY_URL=https://play.<domain> bash -s'`). It goes into
   `dashboard.env`, a rerun without the value keeps it (a wrong value is replaced by running the
   stage again with the right one), and stage 7 warns while it is missing. Like any stage it needs
   a `dietpi-backup 1` snapshot from today first, and a changed value restarts the dashboard, which
   the stage refuses while players are online or a recording runs.
   Plan B sets it itself (`http://localhost:<Foundry port>`; the dashboard there is opened on the
   PC only, so that is the address the browser uses). Players never see portraits, by design.

   **Why no image proxy:** the page on `cogm.<domain>` asks `play.<domain>` for a plain `<img>`.
   The two names share a registrable domain, so the browser counts it as same-site and sends the
   `CF_Authorization` cookie that the GM's Access login for `play.<domain>` already set (no CORS
   needed for an image). Foundry serves its static files without its own login (checked read-only on
   the Pi, 2026-10-28: `curl -I http://127.0.0.1:30000/icons/svg/mystery-man.svg` answers 200).
   If the Access session for `play.` has expired, Access answers with a redirect and the image may
   fail (the login host is cross-site), so the ribbon shows initials. The same holds over the
   Tailscale route, where the browser may hold no `play.` session at all. Open `https://play.<domain>` once (the GM does anyway) and reload
   the dashboard. Not checked end to end here: after the stage runs, look at the ribbon in a real
   fight from `https://cogm.<domain>`. If the portraits stay initials while `play.<domain>` is
   open in another tab, build the GM-only image proxy on the dashboard instead (a route that
   fetches the path from `FOUNDRY_AI_FOUNDRY_URL` and returns it to a GM caller only).

### The player connector's Access application

The player connector (`/mcp/player`) has its own Access application, separate from `Foundry players`
and `Foundry dashboard`. Its policy allows **Service Auth only** (the players' service tokens, one
per player), never an email login: a person's login must not reach this route. The dashboard checks
the same thing again: a token that carries an email is refused, and the token's Client ID must be in
`player-connector.json`. The application's AUD tag goes into that file as `audience`. If the player
hostname ever serves anything but `/mcp/player`, narrow the tunnel's ingress path to
`^/mcp/player$` (the Pi side of this is in the Pi stage script, not here).

For the Claude custom connector there is a second application, `Player remote`, on `player-remote.spennerit.com` with
Managed OAuth and the `Foundry players` email policy. Its AUD tag goes into `player-connector.json` as `appAudience`, with
`emailPlayers` and `remoteEndpoint`; the Pi side is stage 30 (see `docs/dev/pi/network-and-access.md`, "The remote part").

### The GM remote connector (not deployed yet)

The five GM tool sets can be served as Claude custom connectors: `/mcp/core`, `/mcp/play`, `/mcp/prep`,
`/mcp/build` and `/mcp/admin` on the dashboard, one per set, so the Search and tools switches and the
per-set budgets stay as with the local installer. It needs its own Access application, `Dashboard GMs
remote`, with Managed OAuth and the `Dashboard GMs` email policy, **never** `Foundry players`. Its AUD
tag goes into the file named by `FOUNDRY_AI_GM_CONNECTOR_CONFIG` as `appAudience`. Who counts as a GM is
decided again in the dashboard: the file's `gmEmails` list, else `GM_EMAILS`; with neither, or a
`gmEmails` that names nobody usable, every login is refused (503). Variables: `FOUNDRY_AI_GM_CONNECTOR=on`,
`FOUNDRY_AI_GM_CONNECTOR_CONFIG`, and for the test bridge only `FOUNDRY_AI_GM_CONNECTOR_DEV_EMAIL` (a bare
loopback request counts as that email; ignored with a team domain or off loopback). A guarded write that
waits on Foundry for more than about 100 seconds can reach Claude as a Cloudflare 524 although it landed:
check `list-changes` before retrying.

### Removing a player

Cloudflare One, Access controls, Applications, `Foundry players`, Policies, edit `Players`, delete
the person's email, Save. Their old login stays valid until its session (730 hours) runs out, so also open
Team and resources (or Users), find them and choose Revoke. They can no longer reach
Foundry. Their Foundry user in the world stays until the GM removes it in Foundry. If the
`Players` policy is shared with the `Foundry dashboard` application (a reusable policy is), the
same edit also takes their email off `cogm`, and Revoke covers both names; if the dashboard
application has its own copy of the policy, edit that one too.

### The GM's Claude Desktop reaches the bridge (D-095)

Claude Desktop on a GM's PC talks to the bridge's control port (31414). That port has **no login of
its own**, so the Access application is the only gate. The order below keeps the route from ever
existing without its gate.

The `Bridge control` application has two ways in, by design (D-126): the service token below, and
the `Dashboard GMs` policy, so a GM's email code (a one-hour session) also opens Bridge control.
So the token is not the only door. To make it the only one, remove `Dashboard GMs` from this
application.

1. **Service token, made by you.** Cloudflare One, Access controls, Service credentials, Create
   service token, name `gm-claude-desktop` (one per person, for example `gm-claude-desktop-<name>`,
   so each can be revoked alone), duration 12 months or more. Copy the **Client ID** and the
   **secret** now: the secret is shown once. Keep both yourself; never paste them into a chat, the
   repo or the vault, and never create the token through the API (the response holds the secret).
2. **The Access application first.** Access controls, Applications, Add an application, Self-hosted,
   name `Bridge control`, domain `mcp.<domain>`, session duration 1 hour. Policies: the reusable
   `Dashboard GMs` (Allow, the GM and you by email) and a new reusable policy `MCP client` of the
   non-identity kind (Service Auth) that includes the service token from step 1. No Everyone, no
   email-domain rule, no Bypass. Save.
3. **Then the route.** In the tunnel `foundry-pi`, Published application routes, add subdomain
   `mcp`, service type **TCP**, URL `localhost:31414` (the bridge listens on `127.0.0.1:31414` since
   stage 5). The dashboard creates the proxied DNS record. If the tunnel is edited through the API,
   keep the existing rules unchanged and put the new rule before the final catch-all.
4. **Test from a PC with cloudflared** (a spare local port, never 31414 to 31416 on a PC that runs
   its own bridge): run `installer\nsis\tunnel-client.ps1` with `-Action Install -TunnelHost
mcp.<domain> -Port 31914 -CloudflaredPath "<path to your cloudflared.exe>"` (the installer puts
   `cloudflared.exe` next to the script; in the repo you point at your own copy), paste the Client ID
   and the secret when asked, then `-Action Status` (it pings the bridge through the tunnel and
   prints no secret), then `-Action Uninstall`.
5. **Danni or another GM:** the installer in `installer/` has a tunnel option
   ([the GM's page](../gm/connect-claude-desktop.md)). You hand over the Client ID and the secret
   outside the chat (in person or a password manager), never in the repo.

What the PC keeps: `%LOCALAPPDATA%\FoundryMCPServer\tunnel\` with the token stored per Windows user
(DPAPI), a logon task `Foundry AI Tool tunnel` and `cloudflared.exe` in the install folder.
`cloudflared access tcp` listens on `127.0.0.1:<port>` only; Claude Desktop's five entries use that
address with `MCP_NO_SPAWN=1`.

**Check (I-023).** Without the token the name must refuse: `cloudflared access tcp --hostname
mcp.<domain> --url 127.0.0.1:31914` asks for a browser login and gives nothing to a script; with a
wrong token it is refused; `https://mcp.<domain>/` shows the Access page, never the bridge;
`foundry.<domain>:31414`, `cogm.<domain>:31414` and the Pi's public address on 31414 do not answer.
Stage 12 also checks on the Pi that 31414 answers on loopback and nothing listens beyond it (the Pi's own tailscale interface does not count).

**Rotation and removing a GM.** Rotate: create a new token, add it to `MCP client`, run the installer
again (or `tunnel-client.ps1 -Action Install`) and paste the new Client ID and secret: a new token
replaces the stored one (Enter alone at the Client ID prompt keeps the old one). Then delete the old. Remove a GM: Service credentials, delete (or revoke)
that GM's token; the next connection is refused. A lost laptop is the same step.

### If something goes wrong

- **Stop the tunnel:** `ssh foundry-pi systemctl stop foundry-ai-tool-cloudflared` (Foundry and the
  home network are unaffected; the public names then show a Cloudflare error). Or pause the tunnel
  in the Cloudflare dashboard.
- **Change the token** (after Refresh token on the tunnel page): run step 8 again.
- **A Cloudflare 502** on a name: the tunnel is up but the thing behind it is not. Foundry:
  `systemctl status foundry`; dashboard: `systemctl status foundry-ai-tool-dashboard`.
- Stage 12 prints each check (service active, a connection to Cloudflare, nothing listening except
  the tunnel's own status port on loopback) and can be run again at any time.

---

## Settings reference: environment variables that make each hop config-driven

All variables have sane defaults for the local-only case (today). Setting them configures
the remote-hosting topology.

### Bridge / backend (`packages/mcp-server/src/backend.ts` + `config.ts`)

| Variable               | Default        | What it controls                                                                                                                          |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_CONTROL_HOST`     | `127.0.0.1`    | Bind host for the control channel (31414). Keep loopback, always.                                                                         |
| `MCP_CONTROL_PORT`     | `31414`        | Port for the control channel. Change if running two backends side-by-side.                                                                |
| `MCP_FOUNDRY_LINK`     | _(enabled)_    | Set to `off` to run backend as control-only (no Foundry connector).                                                                       |
| `FOUNDRY_LINK_HOST`    | `127.0.0.1`    | Interface for the Foundry link (31415 WS). Set `0.0.0.0` only when the GM's browser is on another machine.                                |
| `FOUNDRY_AI_DATA_DIR`  | platform dir   | Bridge vault (GM-only data, audit log, session log). Default `%APPDATA%\foundry-ai-tool\vault` or `~/.local/share/foundry-ai-tool/vault`. |
| `FOUNDRY_AI_EVENT_LOG` | _(on)_         | `off` disables the persistent session event log (`sessions/<date>.jsonl`).                                                                |
| `FOUNDRY_AI_USAGE_LOG` | _(on)_         | `off` disables the usage log (`sessions/<date>.usage.jsonl`: which dashboard, player-page and module controls get used).                  |
| `FOUNDRY_HOST`         | `localhost`    | **Not used by the bridge itself.** Was legacy; the module dials the bridge, not the other way round. (See note below.)                    |
| `FOUNDRY_PORT`         | `31415`        | WebSocket listen port for the Foundry connector.                                                                                          |
| `FOUNDRY_NAMESPACE`    | `/foundry-mcp` | WebSocket path prefix.                                                                                                                    |
| `FOUNDRY_REMOTE_MODE`  | `false`        | Set `true` when bridge and Foundry are on different machines. Logged at startup only; it changes no behaviour.                            |
| `LOG_LEVEL`            | `warn`         | `error` \| `warn` \| `info` \| `debug`                                                                                                    |

> **Note on `FOUNDRY_HOST`:** The Foundry module dials OUT to the bridge, not the reverse.
> The bridge does not need to know the Foundry host's address. What matters is that the
> bridge's 31415 port is reachable from where Foundry is running.

### Dashboard (`packages/cogm-dashboard/src/config.ts`)

| Variable                               | Default     | What it controls                                                                                                                                                                                                                                               |
| -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                 | `3000`      | HTTP port the dashboard binds. Cloudflare Tunnel proxies this.                                                                                                                                                                                                 |
| `DASHBOARD_HOST`                       | `127.0.0.1` | Listen address. Non-loopback needs a `GM_DASHBOARD_TOKEN` of 32 or more characters.                                                                                                                                                                            |
| `DASHBOARD_ALLOWED_HOSTS`              | _(unset)_   | Extra host names it answers to, e.g. the tunnel's public name (Host check).                                                                                                                                                                                    |
| `DASHBOARD_FOUNDRY_URL`                | _(unset)_   | Foundry as the GM's browser reaches it; ribbon portraits; who may frame Live.                                                                                                                                                                                  |
| `MCP_CONTROL_HOST`                     | `127.0.0.1` | Where the dashboard connects for the control channel.                                                                                                                                                                                                          |
| `MCP_CONTROL_PORT`                     | `31414`     | Control channel port (must match the backend).                                                                                                                                                                                                                 |
| `GM_DASHBOARD_TOKEN`                   | _(unset)_   | Shared secret that grants GM role. Setting this enables the GM/player split.                                                                                                                                                                                   |
| `PLAYER_DASHBOARD_TOKEN`               | _(unset)_   | Optional token required to view the player page.                                                                                                                                                                                                               |
| `GM_EMAILS`                            | _(unset)_   | Comma-separated email addresses that map to GM role (via Cloudflare Access).                                                                                                                                                                                   |
| `CF_ACCESS_TEAM_DOMAIN`                | _(unset)_   | `<team>.cloudflareaccess.com`; with `CF_ACCESS_AUD`, turns on the Access token check.                                                                                                                                                                          |
| `FOUNDRY_AI_PLAYER_CONNECTOR`          | _(unset)_   | `on` serves the read-only `/mcp/player` endpoint (player connector, D-136).                                                                                                                                                                                    |
| `FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG`   | _(unset)_   | Path to `player-connector.json`: `endpoint`, the player Access app's `audience`, and `players` (`clientId`, `clientSecret`, `userId`). Mode 600; the backend reads its `denyTerms` too.                                                                        |
| `FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER` | _(unset)_   | Local testing only: serve this Foundry user id with no login. Ignored (with a warning) off loopback or when `CF_ACCESS_TEAM_DOMAIN` is set; served only to a loopback peer with no proxy or tunnel headers and no `audience` in the file. Never set on the Pi. |
| `PLAYER_SHOW_ENEMY_CONDITIONS`         | `true`      | Let player view see status conditions on enemy combatants.                                                                                                                                                                                                     |
| `PLAYER_SHOW_ENEMY_HP_BANDS`           | `false`     | Let player view see coarse HP bands (e.g. "bloodied") on enemies. `false` hides them.                                                                                                                                                                          |
| `LOG_LEVEL`                            | `info`      | Dashboard server log verbosity.                                                                                                                                                                                                                                |

### Host check (DNS rebinding guard)

The dashboard answers only requests whose `Host` header names it. Everything else gets
`421` with `{"code": "host-not-allowed"}`, on every path, in both modes (split on or off),
before any auth. This stops a DNS rebinding page (an attacker's host name that resolves to
127.0.0.1) from driving the GM endpoints; such a request always carries the attacker's
host name.

Allowed by default, on any port: `localhost`, `127.0.0.1`, `[::1]`, and the host name of
`DASHBOARD_HOST` when it is one specific address (not `0.0.0.0` or `::`).

`DASHBOARD_ALLOWED_HOSTS` adds more: comma-separated host names, IPv4 addresses or
`[IPv6]` addresses, each optionally with `:port`.

- An entry without a port allows any port; `name:port` allows only that port. Browsers
  leave out the default port, so a `Host` without a port counts as port 80 or 443.
- Names compare case-insensitively and otherwise exactly: no wildcards, no subdomains, and
  a trailing dot is not stripped (`localhost.` is refused unless listed as written).
- An invalid entry is ignored with a startup warning that names its position, not its text.
- One `Host` header only: none, two, or a malformed one (user info, a list, a zone id) is
  refused.

Behind a tunnel or a reverse proxy, the `Host` header carries the public name
(cloudflared forwards it unchanged), so that name must be listed:
`DASHBOARD_ALLOWED_HOSTS=cogm.<YOUR_DOMAIN>`. Do the same for a LAN address or name you
browse to (`DASHBOARD_ALLOWED_HOSTS=192.168.1.20,pi.local`), and for the origin in the
bridge's `FOUNDRY_AI_OPEN_BASE` when the Obsidian "Open in Foundry" links point anywhere
but localhost. Do not rewrite the `Host` at the proxy instead (cloudflared
`httpHostHeader`): the `/open` confirm page compares its `Origin` with the `Host` and would
refuse to open anything.

### Auth / role mapping summary

The split is **opt-in**. With no `GM_DASHBOARD_TOKEN` and no `GM_EMAILS`, every request is
treated as GM (today's single-user localhost mode). As soon as either is set, the split
activates and unauthenticated callers land on the read-only `/player` view.

When Cloudflare Access is in front:

1. Cloudflare Access verifies the user's identity (e.g. Google / GitHub OAuth, or a One-Time
   PIN to their email).
2. On success Cloudflare sends a signed login token (`Cf-Access-Jwt-Assertion`) with every
   request reaching the tunnel.
3. The dashboard checks the token (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`: signature,
   issuer, audience, expiry) and compares its email against `GM_EMAILS` (lowercased,
   comma-separated list). Match → GM role. The plain email header is never trusted (I-022).
4. `GM_DASHBOARD_TOKEN` is an alternative / additional credential: present it as a
   `X-CoGM-Token` header, `?token=` query parameter, or `cogm_token` cookie → GM role.
