# Post Service Dockerfile
# Post CRUD with caching (Port 3002)
FROM node:18-alpine AS builder

WORKDIR /app
COPY post-service/package*.json ./
RUN npm ci
COPY post-service/ .

FROM node:18-alpine

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --chown=nodejs:nodejs post-service/ .

USER nodejs
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3002/health || exit 1

CMD ["npm", "start"]
