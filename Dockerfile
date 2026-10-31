# VoidFlippr - production image.
#
# The leaderboard lives in a SQLite database, so mount a volume at /data or
# every score is lost when the container is replaced.
#
#   docker build -t voidflippr .
#   docker run -p 9865:9865 -v voidflippr-data:/data voidflippr

FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=9865 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# Install dependencies first so the layer caches across code changes.
# There are no runtime dependencies; esbuild is only needed to build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev --no-audit --no-fund

# Application code.
COPY server.js build.mjs ./
COPY server/ ./server/
COPY shared/ ./shared/
COPY src/ ./src/
COPY public/ ./public/
COPY 404.html ./

# Build the frontend bundle.
RUN npm install --no-audit --no-fund && npm run build:prod && npm prune --omit=dev

# The leaderboard database and the identity signing secret live here.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 9865

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9865)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]