# Multi-stage build:
#   stage `deps`  — installs native modules (better-sqlite3) under /app/node_modules
#   stage runtime — slim image with non-root user, only artifacts + node_modules
#
# Why two stages: scripts/build.js bundles the backend with esbuild and marks
# `better-sqlite3` external (CJS bundle cannot embed native bindings). At runtime
# `require("better-sqlite3")` from dist-backend/index.cjs walks up to /app/node_modules,
# so we MUST ship the prebuilt native binding in the image — single-stage `COPY dist-*`
# without node_modules crash-loops on first request.

FROM node:22-alpine AS deps
# Build deps for native compilation. Alpine ships musl; better-sqlite3's prebuilt
# binaries are glibc-only, so we compile from source against musl.
RUN apk add --no-cache python3 make g++
WORKDIR /app
# Use the backend manifest so versions stay in sync with what the bundle was tested
# against. Copying just package.json (no lockfile from the workspace root) keeps the
# build context small; npm resolves to compatible patch versions.
COPY backend/package.json ./
RUN npm install --omit=dev --build-from-source

FROM node:22-alpine
# SECURITY: drop root before copying anything. The app does not need privileged
# operations at runtime; running as a non-root user limits container-escape blast
# radius and is required by most compliant container platforms.
# Create the user FIRST, then chown WORKDIR so the app process can write to
# /app at runtime (otherwise WORKDIR stays root-owned and any runtime fs.write
# under /app — tmp restore staging, db sidecars, log files — fails with EACCES).
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
RUN chown app:app /app

# Native bindings + bundled JS deps. dist-backend/index.cjs requires
# `better-sqlite3` from /app/node_modules at runtime.
COPY --chown=app:app --from=deps /app/node_modules ./node_modules
COPY --chown=app:app dist-backend/ ./dist-backend/
COPY --chown=app:app dist-frontend/ ./dist-frontend/

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
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "dist-backend/index.cjs"]
