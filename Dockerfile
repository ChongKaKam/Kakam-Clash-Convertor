ARG MIHOMO_IMAGE=metacubex/mihomo:v1.19.29
FROM ${MIHOMO_IMAGE} AS mihomo

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data MIHOMO_BIN=/usr/local/bin/mihomo
RUN apk add --no-cache ca-certificates
COPY --from=mihomo /mihomo /usr/local/bin/mihomo
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "src/server.js"]
