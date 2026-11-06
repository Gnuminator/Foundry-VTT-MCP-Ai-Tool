# Images for the Orange Pi compose stack (deploy/pi/compose.yml). ARM64, Debian 13 (trixie), Node 24, the same
# versions the Pi runs today under systemd. Build from the repo root:
#   docker build -f deploy/pi/Dockerfile --target app -t foundry-ai-tool-pi/app .
#
# Targets:
#   app         the bridge (packages/mcp-server) and the co-GM dashboard (packages/cogm-dashboard), built like
#               deploy/Dockerfile; the compose services pick the entry point with `command`
#   gm-browser  the Assistant GM: Chromium plus scripts/pi/remote/assistant-gm.mjs
#   foundry     Node only. Foundry itself is licensed and is NEVER baked into an image: compose bind-mounts the
#               host's /opt/foundry read-only. The CI test stack swaps this service for a stand-in.
#
# No secrets in any layer: the env files under /etc/foundry-ai-tool are read by compose at run time.

# node:24-trixie-slim, digest fetched 2026-11-03. Bump it together with the Pi's Node (stage 1).
ARG NODE_IMAGE=node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446

# ---- build: needs devDependencies and tsc ---------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app

# Manifests first, so npm ci is cached until a dependency changes.
COPY package.json package-lock.json ./
COPY packages/mcp-server/package.json     ./packages/mcp-server/
COPY packages/cogm-dashboard/package.json ./packages/cogm-dashboard/
COPY shared/package.json                  ./shared/

RUN npm ci

COPY packages/mcp-server/     ./packages/mcp-server/
COPY packages/cogm-dashboard/ ./packages/cogm-dashboard/
COPY shared/                  ./shared/
COPY tsconfig*.json           ./
# The dashboard's in-app help is rendered from the GM guides at build time (same as deploy/Dockerfile).
COPY docs/gm/                 ./docs/gm/
COPY docs/foundry/            ./docs/foundry/
COPY docs/da/gm/              ./docs/da/gm/
COPY scripts/check-links.mjs  ./scripts/
COPY scripts/tsc7.mjs         ./scripts/

RUN npm run build

# ---- deps: production dependencies only -----------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps

WORKDIR /app
COPY --from=build /app/package.json        ./
COPY --from=build /app/package-lock.json   ./
COPY --from=build /app/packages/mcp-server/package.json     ./packages/mcp-server/
COPY --from=build /app/packages/cogm-dashboard/package.json ./packages/cogm-dashboard/
COPY --from=build /app/shared/package.json                  ./shared/

# The root `prepare` script installs git hooks (husky is a devDependency); an image has no git hooks.
RUN npm pkg delete scripts.prepare && npm ci --omit=dev

# ---- app: bridge and dashboard --------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS app

WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=deps  /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/mcp-server/package.json     ./packages/mcp-server/
COPY --from=build /app/packages/cogm-dashboard/package.json ./packages/cogm-dashboard/
COPY --from=build /app/shared/package.json                  ./shared/
COPY --from=build /app/packages/mcp-server/dist      ./packages/mcp-server/dist/
COPY --from=build /app/packages/cogm-dashboard/dist  ./packages/cogm-dashboard/dist/
COPY --from=build /app/packages/cogm-dashboard/public ./packages/cogm-dashboard/public/
COPY --from=build /app/shared/dist                   ./shared/dist/
COPY deploy/pi/healthcheck.mjs ./healthcheck.mjs

# Compose runs the container as the host's foundry user (user: FOUNDRY_UID:FOUNDRY_GID), so everything here
# is world-readable and nothing is written inside the image; state lives in the mounted TOOL_DATA_DIR.
RUN chmod -R a+rX /app

ENV NODE_ENV=production
# The compose service sets `command` (standalone.js for the bridge, server.js for the dashboard).
CMD ["node", "packages/mcp-server/dist/standalone.js"]

# ---- gm-browser: the Assistant GM -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS gm-browser

# chromium: the same package the Pi uses on the host (stage 5). fonts-liberation: Foundry's default fonts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# A container user has no user namespace for Chromium's sandbox, so the driver's CHROMIUM points at a wrapper
# that adds --no-sandbox. Acceptable here: the browser only loads our own Foundry on loopback.
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox "$@"\n' > /usr/local/bin/chromium-nosandbox \
    && chmod 755 /usr/local/bin/chromium-nosandbox

# assistant-gm.mjs imports only Node built-ins, plus playwright-core, which it loads from TOOL_APP/node_modules.
# TOOL_APP=/opt/gm is a tiny stand-in for the built tool: a package.json and the one dependency.
WORKDIR /opt/gm
COPY --from=deps /app/node_modules/playwright-core ./node_modules/playwright-core
RUN printf '{"name":"gm-browser","private":true,"type":"module"}\n' > package.json
COPY scripts/pi/remote/assistant-gm.mjs ./assistant-gm.mjs
COPY deploy/pi/healthcheck.mjs ./healthcheck.mjs
RUN chmod -R a+rX /opt/gm

ENV NODE_ENV=production \
    TOOL_APP=/opt/gm \
    CHROMIUM=/usr/local/bin/chromium-nosandbox
CMD ["node", "/opt/gm/assistant-gm.mjs", "run"]

# ---- foundry: Node only, Foundry is bind-mounted -------------------------------------------------------------
FROM ${NODE_IMAGE} AS foundry

WORKDIR /app
COPY deploy/pi/healthcheck.mjs ./healthcheck.mjs
RUN chmod -R a+rX /app

ENV NODE_ENV=production
# The compose service sets command and working_dir (/opt/foundry, mounted read-only from the host).
CMD ["node", "/opt/foundry/main.js"]
