# syntax=docker/dockerfile:1

# OfficePM v2 image: the server and the built web client in one container.
#
# Node 24 (the active LTS line, and one of the two versions CI runs). The tag is pinned to the
# multi-platform index digest, so amd64 and arm64 hosts both resolve to a reviewed image.
# To update: docker buildx imagetools inspect node:24-bookworm-slim, then replace the digest.
# Debian (glibc), not Alpine: bcrypt and better-sqlite3 ship glibc prebuilt binaries.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM ${NODE_IMAGE} AS base
# Same pnpm as the packageManager field in package.json. No corepack, so the build does not
# depend on a network fetch it cannot pin.
RUN npm install --global pnpm@10.34.9
WORKDIR /app

# Every workspace manifest, because a frozen install checks the lockfile against all of them.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tests/data-compat/package.json tests/data-compat/package.json
COPY legacy/package.json legacy/package.json

# Production dependencies of the server only. The compiler toolchain is here, and only here,
# in case better-sqlite3 or bcrypt has no prebuilt binary for the platform and has to compile.
FROM manifests AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --prod --filter @officepm/server...

# Everything, to compile the server and bundle the client.
FROM manifests AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    PM_DATA_DIR=/data \
    PM_WEB_DIR=/app/apps/web/dist
WORKDIR /app

# The server finds projects.json three directories above apps/server/dist, so it lives at /app.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json projects.json ./

# pm.db and uploads/ live on the volume, owned by the unprivileged user the server runs as.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "apps/server/dist/main.js"]
