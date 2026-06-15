# Cloudflare Access — Policy Setup Notes

> **Scaffold — not deployed.** This documents how to create the Cloudflare Access
> application and email allow-list that gate the co-GM dashboard, and exactly how those
> settings pair with the dashboard's `GM_EMAILS` / `CF_ACCESS_EMAIL_HEADER` env vars.
> Replace every `<PLACEHOLDER>` with your real values.

---

## What Cloudflare Access does here

Cloudflare Access sits in front of the Cloudflare Tunnel that proxies the co-GM
dashboard. It:

1. Shows a login page to unauthenticated visitors (Google/GitHub OAuth, or email OTP).
2. Verifies the identity against your allow-list policy.
3. Injects the header `cf-access-authenticated-user-email: user@example.com` into every
   request that passes through to the dashboard.
4. Issues a short-lived JWT cookie so repeat visits don't re-trigger the login.

The dashboard's Node server reads that injected header and maps the email to a role:

- Email in `GM_EMAILS` list → **GM role** (full dashboard, write actions available).
- Any other authenticated email → **player role** (read-only `/player` view).

If the header is absent (e.g. a direct localhost request, or Access misconfigured), the
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
| Application name   | `Co-GM Dashboard` (or any label you prefer)     |
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

```
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
lowercased injected email header. Only these addresses get the GM-role view and access
to write actions.

### `CF_ACCESS_EMAIL_HEADER`

```bash
# Default — only change if you have reconfigured the Access header name.
CF_ACCESS_EMAIL_HEADER=cf-access-authenticated-user-email
```

Cloudflare Access injects this header by default. Leave it at the default unless your
team domain is configured to use a custom header name.

### `GM_DASHBOARD_TOKEN` (optional alternative/additional factor)

```bash
GM_DASHBOARD_TOKEN=<RANDOM_SECRET_HEX_32_BYTES>
# Generate with: openssl rand -hex 32
```

If set, presenting this value as:

- Header: `X-GM-Token: <TOKEN>`
- Query param: `?gm_token=<TOKEN>`
- Cookie: `gm_token=<TOKEN>`

...also grants the GM role, regardless of the injected email. Useful for API clients or
scripts that call the dashboard outside a browser session. Keep it secret — treat it like
a password.

### `PLAYER_DASHBOARD_TOKEN` (optional)

```bash
PLAYER_DASHBOARD_TOKEN=<ANOTHER_RANDOM_SECRET>
```

If set, the player view (`/player`) requires this token. Leave unset to let any
Cloudflare-Access-authenticated user (email on the allow-list) reach the player view
without a separate token.

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

- The Cloudflare Access JWT is verified by the tunnel before the request ever reaches
  your host. The injected email header is trustworthy only because it comes through the
  tunnel (not from an external caller who can forge it). Do **not** trust this header on
  direct-to-port requests that bypass the tunnel.
- The `GM_DASHBOARD_TOKEN` must be rotated if compromised — update the env var and
  restart the dashboard.
- The Anthropic API key (`ANTHROPIC_API_KEY`) lives only in the dashboard Node process.
  It is never sent to the browser, never echoed in API responses, and never crosses the
  Cloudflare tunnel in the response direction. This is enforced by the dashboard's server
  architecture (the key is read once at startup and used only for server-side Anthropic
  API calls).
