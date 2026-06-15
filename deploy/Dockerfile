# =============================================================================
#  Foundry AI Tool — Dockerfile TEMPLATE
#  NOT a tested, production image. This is a scaffold for running the bridge
#  backend + co-GM dashboard on an always-on host (Pi/VPS/container). Read the
#  comments before using it.
#
#  What this image includes:
#    - packages/mcp-server  (bridge backend — standalone entrypoint)
#    - packages/cogm-dashboard  (co-GM dashboard Node server)
#    - shared  (internal types package)
#
#  What is intentionally NOT included:
#    - ComfyUI / AI map generation — this is a Windows-local feature that
#      depends on a bundled Python installation and GPU. It does not run in
#      a Linux container.  Map-gen tool calls will return "not available" errors.
#    - The Foundry module — that installs into Foundry, not here.
#    - cloudflared — use the sidecar in docker-compose.yml.template instead.
#
#  Runtime secrets:
#    All secrets (ANTHROPIC_API_KEY, GM_DASHBOARD_TOKEN, GM_EMAILS, etc.) must
#    be injected at runtime via environment variables or Docker secrets. They
#    must NEVER be baked into this image or an image layer.
#
#  Build:
#    docker build -t foundry-ai-tool .
#  Run (minimal):
#    docker run -p 3000:3000 \
#      -e ANTHROPIC_API_KEY=<YOUR_KEY> \
#      -e GM_EMAILS=<YOU@EXAMPLE.COM> \
#      foundry-ai-tool
#  See deploy/docker-compose.yml.template for the full wired-up example.
# =============================================================================

# ── Stage 1: build ──────────────────────────────────────────────────────────
#
# Use a full node image for the build stage (needs npm workspace resolution and
# TypeScript compilation). The result is copied to the lean runtime stage.

FROM node:20-slim AS build

WORKDIR /app

# Copy workspace manifests first so npm install is cached unless deps change.
COPY package.json package-lock.json ./
COPY packages/mcp-server/package.json     ./packages/mcp-server/
COPY packages/cogm-dashboard/package.json ./packages/cogm-dashboard/
COPY shared/package.json                  ./shared/

# Install all workspace dependencies (including devDependencies — needed for tsc).
# --frozen-lockfile ensures reproducible builds.
RUN npm ci --frozen-lockfile

# Copy sources.
COPY packages/mcp-server/     ./packages/mcp-server/
COPY packages/cogm-dashboard/ ./packages/cogm-dashboard/
COPY shared/                  ./shared/
COPY tsconfig*.json           ./

# Build all workspaces. Produces dist/ under each package.
# cogm-dashboard build also copies public/ assets to its dist/.
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
#
# Lean runtime image — no devDependencies, no TypeScript compiler.

FROM node:20-slim AS runtime

# Run as a non-root user for basic container hygiene.
RUN groupadd --gid 1001 nodeapp && \
    useradd  --uid 1001 --gid nodeapp --shell /bin/sh --create-home nodeapp

WORKDIR /app

# Copy workspace manifests and install production dependencies only.
COPY --from=build /app/package.json        ./
COPY --from=build /app/package-lock.json   ./
COPY --from=build /app/packages/mcp-server/package.json     ./packages/mcp-server/
COPY --from=build /app/packages/cogm-dashboard/package.json ./packages/cogm-dashboard/
COPY --from=build /app/shared/package.json                  ./shared/

RUN npm ci --frozen-lockfile --omit=dev

# Copy built artifacts from the build stage.
COPY --from=build /app/packages/mcp-server/dist      ./packages/mcp-server/dist/
COPY --from=build /app/packages/cogm-dashboard/dist  ./packages/cogm-dashboard/dist/
COPY --from=build /app/packages/cogm-dashboard/public ./packages/cogm-dashboard/public/
COPY --from=build /app/shared/dist                   ./shared/dist/

RUN chown -R nodeapp:nodeapp /app
USER nodeapp

# ── Ports ───────────────────────────────────────────────────────────────────
#
# 3000  — co-GM dashboard HTTP + SSE (fronted by cloudflared in compose).
#         NEVER expose this directly to the internet — put the tunnel in front.
#
# 31414 — MCP control channel (TCP JSON-lines). Keep on loopback (see env below).
#         NOT exposed via EXPOSE; it is internal to the container network.
#
# 31415 — Foundry WebSocket connector. The Foundry module dials this.
#         Expose it if the Foundry host needs to reach the bridge directly.
#         (Alternatively, run bridge and dashboard as separate services; see compose template.)
#
# 31416 — Foundry WebRTC signaling endpoint (HTTP POST). Same reach requirements as 31415.
#
EXPOSE 3000
EXPOSE 31415
EXPOSE 31416

# ── Environment defaults ─────────────────────────────────────────────────────
#
# These are defaults suitable for the containerised topology. Override via
# docker run -e, docker-compose env:, or Docker secrets at runtime.
#
# !! NEVER set ANTHROPIC_API_KEY, GM_DASHBOARD_TOKEN, GM_EMAILS here !!
#    Inject them at runtime. Baking them into the image is a security risk.

ENV NODE_ENV=production \
    PORT=3000 \
    MCP_CONTROL_HOST=127.0.0.1 \
    MCP_CONTROL_PORT=31414 \
    FOUNDRY_REMOTE_MODE=true \
    LOG_LEVEL=info

# ── Startup ──────────────────────────────────────────────────────────────────
#
# This entrypoint runs BOTH the standalone bridge (background) and the dashboard
# (foreground) in a single container. The bridge writes its control channel to
# 127.0.0.1:31414 (loopback within the container); the dashboard connects to it.
#
# For a split two-container setup, override CMD in each service:
#   bridge service:    CMD ["node", "packages/mcp-server/dist/standalone.js"]
#   dashboard service: CMD ["node", "packages/cogm-dashboard/dist/server.js"]
# and link them via a shared Docker network with MCP_CONTROL_HOST pointing at
# the bridge container's hostname.
#
# The shell wrapper below starts the bridge in the background, waits briefly for
# the control channel, then starts the dashboard in the foreground (so Docker
# gets the right PID to signal and logs from both go to stdout).

CMD ["/bin/sh", "-c", "\
  node packages/mcp-server/dist/standalone.js & \
  BRIDGE_PID=$! && \
  sleep 3 && \
  node packages/cogm-dashboard/dist/server.js; \
  kill $BRIDGE_PID 2>/dev/null; \
  wait $BRIDGE_PID 2>/dev/null \
"]
