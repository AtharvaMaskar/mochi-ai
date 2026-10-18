# One production container: the agent process (sole owner of the Pi SQLite) serving /, /app, /blog and /api,
# plus the sim helpdesk (:4010) and its webhook listener (:4011) that feed the /app desk.
# FalkorDB runs as its own service. Node 24 runs the .ts sources directly (type stripping), so only the sites build.
FROM node:24-slim AS build
WORKDIR /srv
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY gen/package.json gen/
COPY sim/package.json sim/
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
COPY sim/package.json sim/
COPY agent/package.json agent/
COPY bench/package.json bench/
COPY ui/package.json ui/
COPY landing/package.json landing/
RUN npm ci --omit=dev --no-audit --no-fund -w agent -w gen -w sim && npm cache clean --force
COPY contracts contracts
COPY gen gen
COPY sim sim
RUN node sim/generate.ts --offline
COPY agent agent
COPY data data
COPY deploy deploy
COPY mochi-brain-blog.html story-skill.md ./
COPY --from=build /srv/landing/dist landing/dist
COPY --from=build /srv/ui/dist ui/dist
RUN mkdir -p /data
VOLUME /data
EXPOSE 4000
# ponytail: no supervisor; if the sim or listener dies it stays down until the container restarts.
CMD ["sh", "-c", "node sim/server.ts & node gen/listen.ts & exec node agent/server.ts"]
