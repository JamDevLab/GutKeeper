# Node 24 enthält SQLite (node:sqlite) – es werden keine npm-Pakete benötigt.
FROM node:24-alpine

RUN apk add --no-cache tzdata \
 && mkdir -p /data && chown node:node /data

WORKDIR /app
COPY package.json LICENSE THIRD-PARTY-NOTICES.md ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
