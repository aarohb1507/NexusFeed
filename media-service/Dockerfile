# Media Service Dockerfile
# File upload & CDN integration (Port 3003)
FROM node:18-alpine AS builder

WORKDIR /app
COPY media-service/package*.json ./
RUN npm ci
COPY media-service/ .

FROM node:18-alpine

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --chown=nodejs:nodejs media-service/ .

USER nodejs
EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3003/health || exit 1

CMD ["npm", "start"]
