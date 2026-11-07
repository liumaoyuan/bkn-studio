# syntax=docker/dockerfile:1
# Copyright (c) 2026 OpenBKN
# SPDX-License-Identifier: LicenseRef-OpenBKN
# Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
# Conditions. See LICENSE for the full text.


############################ Stage 0 — build #############################
# dist/ is gitignored and CI runs no pre-build step, so the SPA bundle is
# produced in-image: a single `docker build` yields a self-contained artifact.
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build

# npm registry override; keeps the default upstream behavior when not passed.
ARG NPM_REGISTRY=https://registry.npmjs.org/
# Containers have no usable IPv6 route; without this Node may pick the AAAA
# record first and fail the connection.
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Install the pnpm version pinned by package.json#packageManager directly with
# npm. Corepack's downloader has no timeout/retry controls and fails when the
# registry responds slowly, so let npm handle retries instead.
RUN npm config set registry ${NPM_REGISTRY} \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm install -g pnpm@11.5.1

WORKDIR /app

# Lockfile-only layer first so the dependency install caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --registry=${NPM_REGISTRY} \
      --fetch-retries=5 --fetch-timeout=120000 --network-concurrency=8

COPY . .
# Transpile-only bundle (esbuild via vite) — deliberately NOT `pnpm build`,
# which also runs `tsc -b`. Type safety is a CI gate (`pnpm lint:types` /
# `pnpm check`), so the deployable artifact isn't blocked on an unrelated
# typecheck regression. The browser bundle never needs tsc's output.
# A deployed image must hit the REAL backend: services fall back to the mock
# fixtures unless VITE_USE_MOCK="false", so bake it off for builds. Pass
# --build-arg VITE_USE_MOCK=true to produce a mock/demo image instead.
ARG VITE_USE_MOCK=false
ENV VITE_USE_MOCK=${VITE_USE_MOCK}
RUN pnpm exec vite build

########################### Stage 1 — runtime ###########################
FROM ${NGINX_IMAGE} AS prod

# Vite `base` is /studio/, so the bundle must live under html/studio for its
# absolute asset URLs (/studio/assets/...) to resolve.
COPY --from=build /app/dist /usr/share/nginx/html/studio
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
