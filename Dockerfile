# One production container: the agent process (sole owner of the Pi SQLite) serving /, /app, /blog and /api.
# FalkorDB runs as its own service. Node 24 runs the .ts sources directly (type stripping), so only the sites build.
FROM node:24-slim AS build
WORKDIR /srv
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY gen/package.json gen/
COPY agent/package.json agent/
COPY bench/package.json bench/
COPY ui/package.json ui/
COPY landing/package.json landing/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production PORT=4000 MOCHI_SQLITE=/data/mochi.sqlite
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY gen/package.json gen/
COPY agent/package.json agent/
COPY bench/package.json bench/
COPY ui/package.json ui/
COPY landing/package.json landing/
RUN npm ci --omit=dev --no-audit --no-fund -w agent && npm cache clean --force
COPY contracts contracts
COPY gen gen
COPY agent agent
COPY data data
COPY deploy deploy
COPY mochi-brain-blog.html story-skill.md ./
COPY --from=build /srv/landing/dist landing/dist
COPY --from=build /srv/ui/dist ui/dist
RUN mkdir -p /data
VOLUME /data
EXPOSE 4000
CMD ["node", "agent/server.ts"]
