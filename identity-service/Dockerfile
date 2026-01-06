# Identity Service Dockerfile
# Authentication & Authorization (Port 3001)
FROM node:18-alpine AS builder

WORKDIR /app
COPY identity-service/package*.json ./
RUN npm ci
COPY identity-service/ .

FROM node:18-alpine

WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --chown=nodejs:nodejs identity-service/ .

USER nodejs
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["npm", "start"]
