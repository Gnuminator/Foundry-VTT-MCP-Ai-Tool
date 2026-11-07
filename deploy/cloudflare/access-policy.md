# Cloudflare Access — Policy Setup Notes

> **Scaffold — not deployed.** This documents how to create the Cloudflare Access
> application and email allow-list that gate the dashboard, and exactly how those
> settings pair with the dashboard's `GM_EMAILS`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` env
> vars.
> Replace every `<PLACEHOLDER>` with your real values.

---

## What Cloudflare Access does here

Cloudflare Access sits in front of the Cloudflare Tunnel that proxies the
dashboard. It:

1. Shows a login page to unauthenticated visitors (Google/GitHub OAuth, or email OTP).
2. Verifies the identity against your allow-list policy.
3. Sends a signed login token (the `Cf-Access-Jwt-Assertion` header) with every
   request that passes through to the dashboard.
4. Issues a short-lived JWT cookie so repeat visits don't re-trigger the login.

The dashboard checks that token (signature against your team's public keys, issuer,
audience, expiry; I-022) and maps its email to a role. It never trusts the plain
`cf-access-authenticated-user-email` header, which anyone reaching the dashboard another
way could send:

- Email in `GM_EMAILS` list → **GM role** (full dashboard, write actions available).
- Any other authenticated email → **player role** (read-only `/player` view).

If the verified token is absent (e.g. a direct localhost request, or Access misconfigured), the
dashboard falls back to its legacy behavior: if `GM_EMAILS` is empty and no
`GM_DASHBOARD_TOKEN` is set, every request is treated as GM (local-only mode, safe
because nothing external can reach it without the tunnel).

---

## Creating the Access application

Navigate to `one.dash.cloudflare.com` → **Zero Trust** → **Access** → **Applications** →
**Add an application** → **Self-hosted**.

Fill in:

| Field              | Value                                           |
| ------------------ | ----------------------------------------------- |
| Application name   | `Foundry AI Tool` (or any label you prefer)     |
| Team domain        | `<YOUR_TEAM>.cloudflareaccess.com`              |
| Application domain | `cogm.<YOUR_DOMAIN>`                            |
| Session duration   | 24h (or longer — whatever suits your sessions)  |
| Identity providers | Add at least one (Google, GitHub, or Email OTP) |

After saving the application shell, add a policy:

| Field       | Value                                                |
| ----------- | ---------------------------------------------------- |
| Policy name | `GM email allow-list`                                |
| Action      | Allow                                                |
| Include     | `Emails` → add every address that should have access |

The address list here is **all** users you want to reach the dashboard (GMs and
optionally players if you want them gated too). The GM/player role distinction happens
inside the dashboard, not in the Access policy.

---

## Email allow-list

Add one email address per row in the "Emails" rule. Example structure:

```text
<YOUR_GM_EMAIL>@gmail.com        # you
<COGM_EMAIL>@gmail.com           # co-GM (gets GM role — must also be in GM_EMAILS env var)
<PLAYER1_EMAIL>@gmail.com        # player (gets player role — NOT in GM_EMAILS)
<PLAYER2_EMAIL>@outlook.com      # player
```

Any email NOT in this list gets blocked at the Cloudflare edge — they never reach the
tunnel. This is your outer perimeter.

---

## Pairing Access with the dashboard env vars

### `GM_EMAILS`

```bash
# In your .env or environment:
GM_EMAILS=<YOUR_GM_EMAIL>@gmail.com,<COGM_EMAIL>@gmail.com
```

Comma-separated. The dashboard lowercases all values and compares them against the
lowercased email of a verified Access token. Only these addresses get the GM-role view and
access to write actions.

### `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`

```bash
CF_ACCESS_TEAM_DOMAIN=<YOUR_TEAM>.cloudflareaccess.com
CF_ACCESS_AUD=<the application's Application Audience (AUD) Tag>
```

The team domain is under Zero Trust, Settings, Custom Pages (or the top of the Access
settings). The AUD tag is on the application's Overview tab ("Application Audience (AUD)
Tag"). Without both, email logins are off and `GM_EMAILS` gives nobody the GM role (the
dashboard logs a warning at start).

### `GM_DASHBOARD_TOKEN` (optional alternative/additional factor)

```bash
GM_DASHBOARD_TOKEN=<RANDOM_SECRET_HEX_32_BYTES>
# Generate with: openssl rand -hex 32
```

If set, presenting this value as:

- Header: `x-cogm-token: <TOKEN>`
- Query param: `?token=<TOKEN>`
- Cookie: `cogm_token=<TOKEN>`

...also grants the GM role, whoever logged in through Cloudflare Access. Useful for API clients or
scripts that call the dashboard outside a browser session. Keep it secret. Treat it like
a password.

### `PLAYER_DASHBOARD_TOKEN` (optional)

```bash
PLAYER_DASHBOARD_TOKEN=<ANOTHER_RANDOM_SECRET>
```

If set, the player view (`/player`) requires this token. Leave unset to let any
Cloudflare-Access-authenticated user (email on the allow-list) reach the player view
without a separate token. It only takes effect when `GM_DASHBOARD_TOKEN` or `GM_EMAILS`
is set too: with neither, the dashboard runs in single-user GM mode and everyone is the GM,
token or not.

---

## Verification checklist

- [ ] Access application created for `cogm.<YOUR_DOMAIN>`.
- [ ] Email allow-list policy has at least your own GM email.
- [ ] `GM_EMAILS` env var in the dashboard contains the GM email(s) from the policy.
- [ ] Visit `https://cogm.<YOUR_DOMAIN>` — confirm you are prompted to log in.
- [ ] Log in with a GM email — confirm you reach the GM dashboard.
- [ ] Log in with a non-GM email (if any are on the policy allow-list) — confirm you reach
      the read-only player view.
- [ ] Confirm an unlisted email cannot get past the Cloudflare login page.

---

## Security notes

- The dashboard verifies the `Cf-Access-Jwt-Assertion` token itself (signature, audience
  and team domain; `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`) and takes the email only
  from a verified token. The plain `Cf-Access-Authenticated-User-Email` header is ignored,
  so a request that bypasses the tunnel and forges it gets nothing.
- The `GM_DASHBOARD_TOKEN` must be rotated if compromised — update the env var and
  restart the dashboard.
- The dashboard makes no Anthropic API calls, so no Anthropic API key is stored on the
  host or sent through the tunnel.
