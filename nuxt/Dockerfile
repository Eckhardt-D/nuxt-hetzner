FROM --platform=linux/arm64 oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS install

RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --production

FROM base AS build
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

ENV NODE_ENV=production
RUN bun run build

FROM base AS release
COPY --from=build /usr/src/app/.output/ .output/

USER bun
EXPOSE 3000/tcp
ENTRYPOINT ["bun", "run", ".output/server/index.mjs"]

