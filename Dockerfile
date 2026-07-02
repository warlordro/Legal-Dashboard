# Multi-stage build:
#   stage `build` — compiles dist-backend (esbuild CJS) + dist-frontend (Vite)
#                   from source, so `docker build` works from a clean git clone
#                   (Dokploy/CI build-from-git) with no local pre-build step
#   stage `deps`  — installs native modules (better-sqlite3) under /app/node_modules
#   stage runtime — slim image with non-root user, only artifacts + node_modules
#
# Why the runtime needs node_modules: scripts/build.js bundles the backend with
# esbuild and marks `better-sqlite3` external (CJS bundle cannot embed native
# bindings). At runtime `require("better-sqlite3")` from dist-backend/index.cjs
# walks up to /app/node_modules, so we MUST ship the prebuilt native binding in
# the image — `COPY dist-*` without node_modules crash-loops on first request.

# SHA digest pin (supply chain hardening v2.22.0): resolved 2026-05-12 for
# node:22-alpine. Moving tags can be repointed; pinned digest stops a
# repository takeover from injecting a malicious base image.
# Refresh: `TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull" | jq -r .token); curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json" "https://registry-1.docker.io/v2/library/node/manifests/22-alpine" | grep -i docker-content-digest`
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS build
WORKDIR /app
# Full workspace install (root devDeps carry esbuild; frontend carries Vite).
# --ignore-scripts skips every postinstall on purpose: no Electron binary
# download, no better-sqlite3 native compile (the build stage never loads it —
# esbuild marks it external), no sharp prebuilds. The esbuild/rollup binaries
# arrive as platform optionalDependencies packages, not via install scripts.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --ignore-scripts
# Sources needed by `npm run build` (scripts/build.js): backend esbuild bundle,
# frontend Vite build, migration .sql copy. scripts/check-worktree.mjs (prebuild
# hook) exits silently when .git is absent from the build context.
COPY scripts/ ./scripts/
COPY backend/ ./backend/
COPY frontend/ ./frontend/
RUN npm run build

FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS deps
# Build deps for native compilation. Alpine ships musl; better-sqlite3's prebuilt
# binaries are glibc-only, so we compile from source against musl.
RUN apk add --no-cache python3 make g++
WORKDIR /app
# Reproducible runtime dependency install. The root lockfile contains workspace
# deps, while `--workspace=backend --include-workspace-root=false` installs only
# backend production dependencies into /app/node_modules. `better-sqlite3` is
# built from source for Alpine/musl instead of relying on glibc prebuilds.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --omit=dev --workspace=backend --include-workspace-root=false --build-from-source

FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
# SECURITY: drop root before copying anything. The app does not need privileged
# operations at runtime; running as a non-root user limits container-escape blast
# radius and is required by most compliant container platforms.
# Create the user FIRST, then chown WORKDIR so the app process can write to
# /app at runtime (otherwise WORKDIR stays root-owned and any runtime fs.write
# under /app — tmp restore staging, db sidecars, log files — fails with EACCES).
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
# /data is the canonical mount point for the persistent SQLite volume
# (LEGAL_DASHBOARD_DB_PATH=/data/legal-dashboard.db in both compose files).
# It must exist in the image owned by `app`: a named volume initialised from
# an image without the directory gets created root-owned and the non-root
# backend fails with EACCES on first DB open.
RUN chown app:app /app && mkdir -p /data && chown app:app /data

# Native bindings + bundled JS deps. dist-backend/index.cjs requires
# `better-sqlite3` from /app/node_modules at runtime.
COPY --chown=app:app --from=deps /app/node_modules ./node_modules
# dist-* come from the in-image build stage, NOT from the host context — a
# clean git clone (Dokploy, CI) builds identically to a dev machine.
COPY --chown=app:app --from=build /app/dist-backend/ ./dist-backend/
COPY --chown=app:app --from=build /app/dist-frontend/ ./dist-frontend/
# First-admin provisioning (DEPLOY-SERVER.md §5 runs it via `docker compose
# exec backend node scripts/seed-admin.mjs`; needs only node builtins +
# better-sqlite3 from /app/node_modules).
COPY --chown=app:app --from=build /app/scripts/seed-admin.mjs ./scripts/seed-admin.mjs

# SECURITY: nu bake-uim .env in imagine. Operatorul mounteaza .env la runtime
# (docker-compose env_file / docker run --env-file). Vechiul COPY .env* baga
# secrete in layer-uri si le distribuia odata cu imaginea.

ENV NODE_ENV=production
ENV LEGAL_DASHBOARD_PORT=3002

USER app

EXPOSE 3002

# Healthcheck inside the image so `docker run` (no compose) also benefits.
# Aligns with the docker-compose.yml healthcheck and DR3 readiness gating: the
# `/health` endpoint returns 503 until backend boot/prewarm completes.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "dist-backend/index.cjs"]
