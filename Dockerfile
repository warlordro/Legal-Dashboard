# Multi-stage build:
#   stage `deps`    — production node_modules (native better-sqlite3 compiled for musl)
#   stage `builder` — full install + compile dist-backend/ + dist-frontend/ via scripts/build.js
#   stage runtime   — slim image, non-root user, only artifacts + prod node_modules
#
# Why deps + builder are separate: scripts/build.js bundles the backend with esbuild and
# marks `better-sqlite3` external (CJS bundle cannot embed native bindings). At runtime
# `require("better-sqlite3")` from dist-backend/index.cjs walks up to /app/node_modules,
# so we ship the prebuilt native binding from `deps` (production-only deps). `builder`
# produces the dist-* artifacts inside the image, so the repo needs no committed dist-*.

# SHA digest pin (supply chain hardening): pinned digest stops a repository takeover
# from injecting a malicious base image. Moving tags can be repointed.
# Refresh: TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull" | jq -r .token); curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json" "https://registry-1.docker.io/v2/library/node/manifests/22-alpine" | grep -i docker-content-digest
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS deps
# Build deps for native compilation. Alpine ships musl; better-sqlite3's prebuilt
# binaries are glibc-only, so we compile from source against musl.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --omit=dev --workspace=backend --include-workspace-root=false --build-from-source

# builder: full workspace install (incl dev deps: vite, esbuild) + produce dist-*.
# Runs scripts/build.js directly (not `npm run build`) to skip the `prebuild`
# check-worktree hook, which expects a git worktree not present in the build context.
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
COPY . .
RUN node --experimental-strip-types scripts/build.js

FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f
# SECURITY: drop root before copying anything. The app does not need privileged
# operations at runtime; running as a non-root user limits container-escape blast
# radius and is required by most compliant container platforms.
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
RUN chown app:app /app

# Native bindings + bundled JS deps. dist-backend/index.cjs requires
# `better-sqlite3` from /app/node_modules at runtime.
COPY --chown=app:app --from=deps /app/node_modules ./node_modules
COPY --chown=app:app --from=builder /app/dist-backend/ ./dist-backend/
COPY --chown=app:app --from=builder /app/dist-frontend/ ./dist-frontend/

# SECURITY: nu bake-uim .env in imagine. Operatorul furnizeaza env la runtime
# (Dokploy Environment / docker-compose env).

ENV NODE_ENV=production
ENV LEGAL_DASHBOARD_PORT=3002

USER app

EXPOSE 3002

# Healthcheck inside the image so `docker run` (no compose) also benefits.
# `/health` returns 503 until backend boot/prewarm completes.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "dist-backend/index.cjs"]
