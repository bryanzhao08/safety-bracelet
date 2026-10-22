FROM node:24-slim

ENV NODE_ENV=production PORT=4400 HB_DB=/data/homebound.sqlite HB_DATA_DIR=/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && groupadd --system homebound && useradd --system --gid homebound homebound && mkdir -p /data && chown homebound:homebound /data
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY web/ ./web/

USER homebound
EXPOSE 4400
CMD ["node", "server/index.js"]
