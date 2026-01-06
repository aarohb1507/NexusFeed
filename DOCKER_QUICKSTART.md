# Docker Quick Start & Architecture Summary

## 30-Second Overview

**NexusFeed** is containerized as 5 microservices + 3 infrastructure containers:

```
Client requests → API Gateway:3000 → (5 services) → RabbitMQ ← (async indexing)
                                              ↓
                                          MongoDB + Redis
```

- **HTTP**: Synchronous service-to-service via API Gateway
- **RabbitMQ**: Asynchronous events (search indexing, media cleanup)
- **Docker Network**: All services communicate via container DNS names
- **Volumes**: MongoDB, Redis, RabbitMQ persist data

---

## Start the Stack

```bash
# Pull base images
docker-compose pull

# Build service images (first time)
docker-compose build

# Start everything
docker-compose up -d

# Wait 60 seconds for startup, then test
curl http://localhost:3000/health
curl http://localhost:3000/v1/auth/register -X POST ...
```

---

## Architecture at a Glance

### Image Build
- **Multi-stage Dockerfile**: Reduces image from 400MB to 165MB
- **Alpine base**: Security + lightweight
- **Non-root user**: Container runs as `nodejs:nodejs`
- **Health checks**: Auto-restart failed containers

### Networking
- **Bridge network**: `nexusfeed-network`
- **Service discovery**: `http://post-service:3002` (internal DNS)
- **Port exposure**: Only `:3000` to host (API Gateway)
- **Isolation**: Services can't reach external IPs by default

### Persistence
- **mongo-data**: Database (MongoDB)
- **redis-data**: Cache (Redis)
- **rabbitmq-data**: Message queue (RabbitMQ)
- **Stateless services**: Can be recreated anytime

---

## Service Roles

| Service | Port | Role | Dependencies |
|---------|------|------|--------------|
| **api-gateway** | 3000 | Entry point, rate limiting, routing | Redis |
| **identity-service** | 3001 | JWT auth, user management | MongoDB |
| **post-service** | 3002 | CRUD posts, caching | MongoDB, Redis, RabbitMQ |
| **media-service** | 3003 | File uploads, CDN | MongoDB, RabbitMQ, Cloudinary |
| **search-service** | 3004 | Full-text search, event indexing | MongoDB, Redis, RabbitMQ |

---

## Communication Contracts

### Synchronous (HTTP/REST)
```
Client → API Gateway:3000
         ↓
    Internal routing (gateway proxies to services)
         ↓
    Service responds → Gateway → Client
    
Timeout: 30 seconds
Failure: Returns 5xx error
```

**Example URLs** (internal, gateway-routed):
- `POST /v1/auth/register` → identity-service:3001
- `POST /v1/posts/create-post` → post-service:3002
- `POST /v1/media/upload` → media-service:3003
- `GET /v1/search?q=...` → search-service:3004

### Asynchronous (RabbitMQ)
```
Service A publishes event → RabbitMQ Topic Exchange
                               ↓
                         Service B receives (async)
                         Service C receives (async)
                               ↓
                         Fire-and-forget, retries on failure
```

**Event Types**:
- `post.created` → Search indexes, Media links
- `post.deleted` → Search un-indexes, Media cleanup
- `media.uploaded` → Post notified

---

## Docker Compose Startup Sequence

```
Step 1 (0s):   Start mongo, redis, rabbitmq
Step 2 (5s):   Infrastructure containers booting, health checks pending
Step 3 (15s):  All 3 infrastructure healthy ✓
               Trigger dependent services
Step 4 (20s):  Start identity, post, media, search services
               Each connects to mongo/redis/rabbitmq
Step 5 (45s):  All app services healthy ✓
               Trigger api-gateway startup
Step 6 (60s):  api-gateway healthy ✓
               System ready for requests
```

**Key**: Each service waits for dependencies to be healthy (not just started)

---

## Environment Variables

All services read from `.env.docker`:

```bash
# Infrastructure (internal container DNS)
MONGODB_URI=mongodb://root:rootpassword@mongo:27017/nexusfeed?authSource=admin
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672

# Service discovery (internal URLs)
IDENTITY_SERVICE_URL=http://identity-service:3001
POST_SERVICE_URL=http://post-service:3002
MEDIA_SERVICE_URL=http://media-service:3003
SEARCH_SERVICE_URL=http://search-service:3004

# Security
JWT_SECRET=<change in production>
```

---

## Network Architecture

```
┌─ Host Machine ─────────────────────────┐
│  localhost:3000 ↔ Docker port mapper   │
└────────────┬──────────────────────────┘
             │ Docker bridge translation
             │ (localhost:3000 → nexusfeed-api-gateway)
             ▼
┌─ Docker Bridge Network: nexusfeed-network ─┐
│                                             │
│  172.19.0.2: api-gateway:3000              │
│  172.19.0.3: identity-service:3001         │
│  172.19.0.4: post-service:3002             │
│  172.19.0.5: media-service:3003            │
│  172.19.0.6: search-service:3004           │
│                                             │
│  172.19.0.7: mongo:27017                   │
│  172.19.0.8: redis:6379                    │
│  172.19.0.9: rabbitmq:5672                 │
│                                             │
│  Internal DNS: post-service:3002            │
│                ↓                             │
│            172.19.0.4:3002                  │
│                                             │
└─────────────────────────────────────────────┘
```

**Key insight**: Services use container DNS names; Docker resolves to IPs internally.

---

## Health Check Design

Each container reports health status every 30 seconds:

```
GET http://localhost:PORT/health
Response: { "status": "ok", "service": "post-service" }
```

**Docker behavior**:
- Checks start after 5-second grace period
- Service marked unhealthy after 3 consecutive failures
- Docker restarts unhealthy containers automatically

---

## Volume & Persistence Strategy

```
Named Volumes (managed by Docker):
├─ mongo-data
│  └─ /var/lib/docker/volumes/nexusfeed_mongo-data/_data
│     └─ Database files persist across restarts
│
├─ redis-data
│  └─ /var/lib/docker/volumes/nexusfeed_redis-data/_data
│     └─ Cache + rate limit data persists
│
└─ rabbitmq-data
   └─ /var/lib/docker/volumes/nexusfeed_rabbitmq-data/_data
      └─ Message queue data persists

Behavior:
docker-compose down       → Stops containers, keeps volumes
docker-compose down -v    → Stops containers, deletes volumes
docker-compose up         → Remounts volumes, data intact
```

**Services themselves**: No volumes (stateless)
- Can scale to 10 replicas without data issues
- All state in mongo/redis/rabbitmq

---

## Scaling Architecture (Future)

### Current (Single Instance)
```yaml
docker-compose.yml
├─ 1x api-gateway
├─ 1x identity-service
├─ 1x post-service
└─ 1x mongo (shared)
```

### Future (Horizontal Scaling)
```yaml
post-service:
  deploy:
    replicas: 3  # 3 instances behind load balancer
    
search-service:
  deploy:
    replicas: 2  # 2 instances
```

**All replicas share**: Single MongoDB, Redis, RabbitMQ

---

## Troubleshooting

### Service won't start
```bash
docker-compose logs post-service
# Check: 
# 1. Environment variables correct?
# 2. Dependencies healthy?
# 3. Port already in use?
```

### Container keeps restarting
```bash
docker-compose ps
# Shows state of containers

docker inspect nexusfeed-post-service
# Shows last exit code, healthcheck history
```

### Can't connect between services
```bash
docker-compose exec post-service sh
# Inside container:
ping search-service
curl http://search-service:3004/health
```

### Out of disk space
```bash
docker-compose down -v
# Removes volumes to free space
```

---

## Common Commands

```bash
# Lifecycle
docker-compose up -d              # Start
docker-compose down               # Stop
docker-compose down -v            # Stop + remove volumes
docker-compose restart            # Restart all
docker-compose ps                 # Status

# Build
docker-compose build              # Build all
docker-compose build --no-cache   # Force rebuild

# Logs
docker-compose logs -f            # Follow all
docker-compose logs -f post-service # Follow one
docker-compose logs --tail 50     # Last 50 lines

# Debugging
docker-compose exec post-service sh   # Shell
docker-compose stats                  # Resource usage
docker-compose pause                  # Pause (don't stop)
docker-compose unpause                # Resume
```

---

## Design Principles Applied

| Principle | Implementation |
|-----------|-----------------|
| **Separation of Concerns** | Each service has one job (SRP) |
| **Loose Coupling** | Event-driven async, not direct calls |
| **Statelessness** | Services don't hold state (easy to scale) |
| **Resilience** | Health checks, retries, timeouts |
| **Observability** | Logs to STDOUT, health endpoints |
| **Security** | Non-root users, network isolation |

---

## What Happens When You Press Enter on `docker-compose up -d`

1. **Network created**: `nexusfeed-network` bridge
2. **Volumes created**: `mongo-data`, `redis-data`, `rabbitmq-data`
3. **Infrastructure containers started**:
   - MongoDB listens on :27017 (internal DNS: `mongo`)
   - Redis listens on :6379 (internal DNS: `redis`)
   - RabbitMQ listens on :5672 (internal DNS: `rabbitmq`)
4. **Service containers wait** for dependencies' health checks
5. **Application containers start** (identity, post, media, search)
   - Each connects to mongo/redis/rabbitmq using DNS names
   - Each registers on bridge network
6. **API Gateway starts last**
   - Depends on all services being healthy
   - Listens on :3000 (exposed to host)

**Total time**: ~60 seconds (first time), ~10 seconds (subsequent)

---

## Production Checklist

- [ ] Change `JWT_SECRET` to 64-character random string
- [ ] Change MongoDB credentials
- [ ] Set real Cloudinary API keys
- [ ] Remove infrastructure ports from docker-compose (keep only 3000)
- [ ] Add reverse proxy (Nginx) for TLS/HTTPS
- [ ] Configure centralized logging (ELK, Splunk, Datadog)
- [ ] Add monitoring (Prometheus, Grafana)
- [ ] Set resource limits per service
- [ ] Configure secrets management (Docker Secrets, Vault)
- [ ] Set up CI/CD pipeline to build & deploy

---

## Files to Review

1. **CONTAINERIZATION.md** - Deep dive on image build, design principles
2. **DOCKER_DESIGN.md** - Complete guide with examples and troubleshooting
3. **SERVICE_CONTRACTS.md** - HTTP endpoints, RabbitMQ events, data flows
4. **docker-compose.yml** - Actual orchestration (read this next)
5. **Dockerfile** files - One per service (see image build strategy)

---

## Next Steps

```bash
# 1. Review docker-compose.yml structure
cat docker-compose.yml

# 2. Build images
docker-compose build

# 3. Start stack
docker-compose up -d

# 4. Monitor startup
watch docker-compose ps

# 5. Test API
curl http://localhost:3000/health

# 6. View logs
docker-compose logs -f api-gateway
```

