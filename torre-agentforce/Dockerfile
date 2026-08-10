# syntax=docker/dockerfile:1.7

# Node 22 is required by package.json and by the built-in TypeScript type stripping.
# The multi-arch manifest digest makes builds reproducible across supported platforms.
ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

FROM ${NODE_IMAGE} AS verify
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# Production CSS and Mermaid are built/vendored locally; no runtime CDN or Google
# Fonts are allowed. A failed frontend build or type check prevents the runtime image.
RUN npm run build:frontend \
    && test -s publico/js/vendor/mermaid.min.js \
    && npm run typecheck

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=verify --chown=node:node /app/package.json ./package.json
COPY --from=verify --chown=node:node /app/src ./src
COPY --from=verify --chown=node:node /app/publico ./publico

USER node
EXPOSE 3000

# Liveness only. `/salud` deliberately does not query or reveal dependencies;
# authenticated dependency readiness is served separately at `/api/admin/salud`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/salud`).then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "--experimental-strip-types", "src/servidor/index.ts"]
