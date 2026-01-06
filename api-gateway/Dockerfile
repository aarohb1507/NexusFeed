# API Gateway Dockerfile
# Single entry point for all client requests (Port 3000)
FROM node:18-alpine AS builder

WORKDIR /app
COPY api-gateway/package*.json ./
RUN npm ci
COPY api-gateway/ .

FROM node:18-alpine

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --chown=nodejs:nodejs api-gateway/ .

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["npm", "start"]
