# deploy/ — Deployment Scaffolds

> Every file in this folder is a **scaffold / template, not a deployed artifact**.
> Nothing here is executed by CI, nothing is wired to live infrastructure, and nothing
> has been tested against a real host. Fill in the `<PLACEHOLDER>` values and adapt to
> your host before using any of it.

**Start here for context:** `docs/dev/REMOTE-ACCESS.md` — the full operational setup guide
with topology diagram, env-var table, and step-by-step Cloudflare Tunnel + Access
walkthrough.

---

## Contents

```text
deploy/
├── README.md                            ← you are here
│
├── Dockerfile                           ← multi-stage image (build + runtime)
│                                          Runs bridge + dashboard in one container.
│
├── docker-compose.yml.template          ← wires the app container + cloudflared sidecar.
│                                          Fill in secrets and the cloudflare/ config,
│                                          then: docker compose up -d
│
├── cloudflare/
│   ├── config.yml.template              ← cloudflared tunnel config.
│   │                                     Copy to ~/.cloudflared/config.yml on your host.
│   │                                     Fill in <TUNNEL_UUID> and <YOUR_DOMAIN>.
│   │
│   └── access-policy.md                 ← How to create the Cloudflare Access application
│                                          and email allow-list, and how it maps to
│                                          GM_EMAILS / CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD.
│
└── windows/
    ├── install-service.md               ← Run the standalone bridge as a Windows service
    │                                     (NSSM or Task Scheduler). Already exists.
    └── start-bridge.cmd                 ← Double-click launcher for the standalone bridge.
                                          Already exists.
```

---

## Quick orientation

| Goal                                    | Start with                                                        |
| --------------------------------------- | ----------------------------------------------------------------- |
| Understand the full remote topology     | `docs/dev/REMOTE-ACCESS.md`                                       |
| Run bridge + dashboard on a Linux host  | `Dockerfile` + `docker-compose.yml.template`                      |
| Set up the Cloudflare Tunnel            | `cloudflare/config.yml.template` + `docs/dev/REMOTE-ACCESS.md §3` |
| Configure Cloudflare Access email gates | `cloudflare/access-policy.md`                                     |
| Keep the bridge alive on Windows today  | `windows/install-service.md`                                      |

---

## Seams (what you fill in)

Before any of these templates can run, every `<PLACEHOLDER>` must be replaced with a real
value. The complete list is in `docs/dev/REMOTE-ACCESS.md §5 (seams list)`. Short summary:

- `<TUNNEL_UUID>` — from `cloudflared tunnel create cogm`
- `<YOUR_DOMAIN>` — the domain on your Cloudflare account (e.g. `example.com`)
- `<YOUR_LINUX_USER>` — the user account on the always-on host
- `ANTHROPIC_API_KEY` — your Anthropic API key (runtime env/secret, never in the image)
- `GM_EMAILS` — comma-separated email addresses that get the GM role
- `GM_DASHBOARD_TOKEN` — a random secret for token-based GM auth (`openssl rand -hex 32`)

---

## What is not here (intentional gaps)

- **Reverse-proxy / TLS for the Foundry connector** — port 31415 is exposed directly;
  TLS termination for it is future work.
- **Auth middleware code** — the player/GM split is live in the dashboard config
  (`GM_EMAILS`, `GM_DASHBOARD_TOKEN`), but the middleware that enforces it per-route
  is a Phase 6 deliverable.
- **CI/CD pipeline** — no automated image builds are set up yet.
