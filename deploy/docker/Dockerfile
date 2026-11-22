# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS workspace

ENV CI=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY .npmrc package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.node.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN npm ci --ignore-scripts
RUN npm run build --workspace @unspool/runner-api

FROM node:24-bookworm-slim AS runner-api

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY --from=workspace /app/node_modules ./node_modules
COPY --from=workspace /app/apps/runner-api/package.json ./apps/runner-api/package.json
COPY --from=workspace /app/apps/runner-api/dist ./apps/runner-api/dist
COPY --from=workspace /app/packages ./packages

RUN mkdir -p /var/lib/unspool && chown node:node /var/lib/unspool

USER node

EXPOSE 8443

CMD ["node", "apps/runner-api/dist/apps/runner-api/src/index.js"]

FROM node:24-bookworm-slim AS execution-worker

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY --from=workspace /app/package.json ./package.json
COPY --from=workspace /app/apps/runner-api/dist/apps/execution-worker ./apps/execution-worker

USER node

EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --retries=12 --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/execution-worker/src/server.js"]

FROM node:24-alpine AS health-stub

WORKDIR /app

COPY deploy/docker/health-stub.mjs ./health-stub.mjs

USER node

CMD ["node", "health-stub.mjs"]
