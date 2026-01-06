# Docker Compose Design Guide

## Quick Reference

### Start the Stack
```bash
docker-compose up -d
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f post-service

# Follow only errors
docker-compose logs -f | grep -i error
```

### Stop Everything
```bash
docker-compose down
```

### Remove Volumes (Data Cleanup)
```bash
docker-compose down -v
```

### Rebuild Images
```bash
docker-compose build --no-cache
```

---

## Image Build Design

### Multi-Stage Dockerfile Benefits

**Stage 1: Builder**
- Installs all npm dependencies
- Runs full Node.js Alpine environment
- Creates bloated intermediate image

**Stage 2: Runtime**
- Copies ONLY `node_modules` from builder
- Discards build tools, package managers
- Creates lean production image (~180MB vs ~400MB)

**Example size savings for post-service**:
```
Single-stage (dev build included):  385MB
Multi-stage (prod optimized):       165MB
Savings:                            220MB (57%)
```

### Security: Non-Root User
```dockerfile
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs
```

**Why**: Prevents container breakout to host. If compromised, attacker has limited privileges.

### Health Checks
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1
```

**Behavior**:
- Every 30 seconds, curl `/health` endpoint
- If no response in 10 seconds = timeout
- Start checking after 5-second grace period
- Mark unhealthy after 3 failures
- Docker will restart unhealthy containers

---

## Container Networking Design

### Bridge Network: `nexusfeed-network`

All services connect to a **custom bridge network** (not the default bridge).

**Service Discovery**:
```
Within container: http://post-service:3002
↓
Docker embedded DNS resolver
↓
Resolves to container IP (e.g., 172.19.0.5)
↓
Direct container-to-container communication
```

**Example from api-gateway**:
```javascript
// Gateway doesn't need IP addresses:
const postServiceUrl = 'http://post-service:3002'
const response = await fetch(`${postServiceUrl}/api/posts`)
```

### Port Exposure Strategy

**Only Gateway Exposed to Host**:
```
Host Machine          Docker Network
─────────────────     ──────────────────
:3000 ────────→ api-gateway:3000
                      ↓
                 (bridge network)
                      ↓
        post-service:3002 (no host exposure)
        media-service:3003 (no host exposure)
        search-service:3004 (no host exposure)
        identity-service:3001 (no host exposure)
```

**Security Benefit**: 
- Clients can only reach API Gateway
- Services are isolated from external attacks
- Service ports not open on host

### DNS Resolution Example

**Request flow**:
```
1. api-gateway makes request:
   axios.get('http://identity-service:3001/api/validate-token')
   
2. Docker DNS resolver in api-gateway container:
   Query: identity-service → 172.19.0.2
   
3. Send request to 172.19.0.2:3001 within bridge
   
4. Response returns to api-gateway container
```

---

## Service Communication Contracts

### HTTP/REST (Synchronous)

**Request Pattern**:
```
Client (browser/mobile)
  ↓ HTTP Request
API Gateway (3000)
  ├─→ route: /v1/posts/* → http://post-service:3002/api/posts/*
  ├─→ route: /v1/auth/* → http://identity-service:3001/api/auth/*
  ├─→ route: /v1/media/* → http://media-service:3003/api/media/*
  └─→ route: /v1/search → http://search-service:3004/api/search
  ↓
Response
```

**Gateway Port Mapping**:
```yaml
# docker-compose.yml
api-gateway:
  ports:
    - "3000:3000"  # Host:Container
```

**Service-to-Service Port Mapping** (internal, no host binding):
```yaml
post-service:
  ports:
    - "3002:3002"  # Container only, not exposed to host
  # Gateway accesses via: http://post-service:3002
```

### RabbitMQ (Asynchronous Events)

**Event Flow**:
```
┌─ Post Service publishes event
│
├─→ RabbitMQ exchange: facebook_events (topic)
│
├─ Message routing keys:
│  ├─ post.created
│  ├─ post.deleted
│  ├─ media.uploaded
│  └─ search.indexed
│
└─→ Consumers subscribe to routing keys:
   ├─ Search Service: post.created, post.deleted (index updates)
   ├─ Media Service: post.deleted (cleanup)
   └─ Post Service: search.indexed (cache invalidation)
```

**Connection String** (Docker network):
```
amqp://guest:guest@rabbitmq:5672
```

**Why Async**:
- Post service doesn't wait for search indexing
- Failures don't cascade (media cleanup queued)
- Eventual consistency across services

---

## Docker Compose YAML Design

### Service Dependency Chain

```
1. mongo (database)
   ├─ healthcheck: mongosh -eval "db.adminCommand('ping')"
   
2. redis (cache)
   ├─ healthcheck: redis-cli ping
   
3. rabbitmq (message broker)
   ├─ healthcheck: rabbitmq-diagnostics -q ping

4. identity-service
   ├─ depends_on: mongo (healthy)
   
5. post-service
   ├─ depends_on: mongo, redis, rabbitmq (healthy)
   
6. media-service
   ├─ depends_on: mongo, rabbitmq (healthy)
   
7. search-service
   ├─ depends_on: mongo, redis, rabbitmq (healthy)
   
8. api-gateway
   ├─ depends_on: all services (healthy)
```

**Why this order**:
- Database must exist before services connect
- Services must be ready before gateway routes
- Gateway is last to ensure all backends available

### Environment Variable Injection

**From `.env.docker`**:
```yaml
identity-service:
  environment:
    MONGODB_URI: mongodb://root:rootpassword@mongo:27017/...
    REDIS_URL: redis://redis:6379
    RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
```

**Service reads**:
```javascript
// identity-service/src/server.js
const mongoUri = process.env.MONGODB_URI
const redisUrl = process.env.REDIS_URL
const mongoClient = new MongoClient(mongoUri)
```

**Key Points**:
- URLs use **container DNS names** (not IPs)
- MongoDB: `mongo:27017` (internal bridge address)
- Redis: `redis:6379`
- RabbitMQ: `rabbitmq:5672`

---

## Volume Persistence Design

### Three Persistent Volumes

```yaml
volumes:
  mongo-data:     # /data/db inside container
  redis-data:     # /data inside container
  rabbitmq-data:  # /var/lib/rabbitmq inside container
```

**Docker manages locations**:
```bash
ls /var/lib/docker/volumes/
# nexusfeed_mongo-data/_data
# nexusfeed_redis-data/_data
# nexusfeed_rabbitmq-data/_data
```

**Persistence behavior**:
```
docker-compose down           → Containers stop, volumes remain
docker-compose down -v        → Containers + volumes deleted
docker-compose up -d          → Volumes remounted, data restored
```

**Service containers are STATELESS**:
- No volumes for api-gateway, post-service, etc.
- All state in mongo/redis/rabbitmq
- Can be recreated anytime

---

## Startup Sequence & Health Checks

### Startup Flow (with timings)

```
T=0s   docker-compose up -d
         ├─ Start mongo container
         ├─ Start redis container
         └─ Start rabbitmq container

T=5s   Infrastructure containers booting
         ├─ mongo health check: PENDING
         ├─ redis health check: PENDING
         └─ rabbitmq health check: PENDING

T=15s  mongo healthy ✓
       redis healthy ✓
       rabbitmq healthy ✓
         └─ Trigger dependent services

T=20s  Start identity-service
       Start post-service
       Start media-service
       Start search-service
         └─ Each connects to mongo/redis/rabbitmq

T=45s  All application services healthy ✓
       Trigger api-gateway startup

T=60s  api-gateway healthy ✓
       Stack ready for requests
```

### Health Check Implementation

**Docker Compose behavior**:
```yaml
healthcheck:
  test: wget --quiet --tries=1 --spider http://localhost:3000/health
  interval: 30s        # Check every 30 seconds
  timeout: 10s         # Wait 10 seconds for response
  start_period: 10s    # Don't check first 10 seconds
  retries: 3           # Restart after 3 failures
```

**Expected endpoint**:
```
GET /health
Response: 200 OK
{
  "status": "ok",
  "service": "post-service"
}
```

---

## Network Isolation & Security

### What's Exposed to Host

```
Host Machine
├─ :3000 → api-gateway (EXPOSED)
├─ :27017 → mongo (EXPOSED for dev convenience)
├─ :6379 → redis (EXPOSED for dev convenience)
├─ :5672 → rabbitmq (EXPOSED for dev convenience)
├─ :15672 → rabbitmq mgmt UI (http://localhost:15672)
│
└─ (NOT EXPOSED)
   ├─ :3001 identity-service (internal only)
   ├─ :3002 post-service (internal only)
   ├─ :3003 media-service (internal only)
   └─ :3004 search-service (internal only)
```

**Development convenience**:
- Can `curl localhost:27017` to test MongoDB
- Can access RabbitMQ UI: `http://localhost:15672`

**Production approach**:
- Remove infrastructure ports from compose
- Only expose :3000
- Services communicate internally via bridge

### Container-to-Container Communication

```
nexusfeed-api-gateway
  ├─ Can reach: post-service:3002 ✓ (same network)
  ├─ Can reach: identity-service:3001 ✓
  ├─ Cannot reach: external-service.com (no route)
  └─ Cannot reach: host machine IP (isolated)

nexusfeed-post-service
  ├─ Can reach: mongo:27017 ✓
  ├─ Can reach: redis:6379 ✓
  ├─ Can reach: rabbitmq:5672 ✓
  ├─ Can reach: api-gateway:3000 ✓ (optional)
  └─ Cannot reach: identity-service:3001 (unless explicitly needed)
```

---

## Example: Complete Request Flow

### Create a Post (Example)

```
1. Client sends POST to http://localhost:3000/v1/posts/create-post
   {
     "content": "Hello World",
     "mediaIds": ["media-123"]
   }

2. API Gateway receives on port 3000
   ├─ Rate limiter (Redis): Check requests from this IP
   ├─ Auth middleware: Validate JWT from Authorization header
   └─ Route to: http://post-service:3002/api/posts/create-post

3. Post Service (container) receives on 3002
   ├─ Save to MongoDB: posts collection
   └─ Publish event: post.created
        │
        ├─→ RabbitMQ (rabbitmq:5672)
        │   Exchange: facebook_events
        │   Routing key: post.created
        │   Body: { postId, userId, content, mediaIds }
        │
        └─ Response to Gateway: 201 Created

4. Search Service (listening on rabbitmq)
   ├─ Receives post.created event
   ├─ Inserts into Search collection (denormalized)
   └─ Creates text index

5. Media Service (listening on rabbitmq)
   ├─ Receives post.created event
   ├─ Links media documents to post
   └─ Updates Media collection

6. Gateway receives response from Post Service
   ├─ Returns to client: 201 Created + postId
   └─ All services eventually consistent

Total time: ~200ms (synchronous part)
           + async indexing/linking in background
```

### Network addresses used
```
Client          → 127.0.0.1:3000 (api-gateway)
                  ↓ (Docker bridge translation)
API Gateway     ← 172.19.0.6 (container IP)
  ├─ to Post    → 172.19.0.3:3002 (docker DNS: post-service:3002)
  ├─ to Auth    → 172.19.0.2:3001 (docker DNS: identity-service:3001)
  └─ to Redis   → 172.19.0.4:6379 (docker DNS: redis:6379)
```

---

## Scaling Considerations

### Current Architecture (Single Instance)
```
docker-compose.yml
├─ 1x api-gateway
├─ 1x identity-service
├─ 1x post-service
├─ 1x media-service
├─ 1x search-service
├─ 1x mongo
├─ 1x redis
└─ 1x rabbitmq
```

### Future: Horizontal Scaling (Kubernetes/Docker Swarm)

```yaml
version: '3.9'
services:
  post-service:
    deploy:
      replicas: 3      # 3 replicas of post-service
    environment:
      SERVICE_INSTANCE: 1  # Track which replica
```

**Behind Load Balancer**:
```
Nginx/HAProxy
├─ :3000 → api-gateway:3000
├─ :3002-1 → post-service-1:3002
├─ :3002-2 → post-service-2:3002
└─ :3002-3 → post-service-3:3002
```

**All replicas share**:
- Single MongoDB instance
- Single Redis instance
- Single RabbitMQ instance

---

## Environment Variables Reference

### Injected into Services
```
MONGODB_URI=mongodb://root:rootpassword@mongo:27017/nexusfeed?authSource=admin
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
```

### Service Discovery
```
API_GATEWAY_URL=http://api-gateway:3000
IDENTITY_SERVICE_URL=http://identity-service:3001
POST_SERVICE_URL=http://post-service:3002
MEDIA_SERVICE_URL=http://media-service:3003
SEARCH_SERVICE_URL=http://search-service:3004
```

### Application Config
```
JWT_SECRET=nexusfeed_dev_secret_...
CLOUDINARY_CLOUD_NAME=...
RATE_LIMIT_MAX_REQUESTS=100
CACHE_TTL_POSTS=300
```

---

## Troubleshooting

### Container won't start
```bash
docker-compose logs service-name
# Check environment variables
# Check network connectivity
# Verify dependencies are healthy
```

### Service can't reach another service
```bash
# From container shell
docker-compose exec post-service sh
# Inside container:
ping identity-service
curl http://identity-service:3001/health
```

### Database connection refused
```bash
# Verify mongo is running and healthy
docker-compose logs mongo
# Check mongodb connection string
# Verify credentials in environment
```

### Out of disk space (volumes)
```bash
docker-compose down -v  # Remove volumes
docker volume prune      # Clean orphaned volumes
```

---

## Development Workflow

### Standard Dev Loop
```bash
# Build and start
docker-compose up -d

# Watch logs
docker-compose logs -f

# Edit code locally
vim post-service/src/server.js

# Rebuild affected service
docker-compose build post-service
docker-compose up -d post-service

# Verify with logs
docker-compose logs -f post-service
```

### Hot Reload (with nodemon)
Services already configured to restart on code changes.
Using volume mounts (optional, for faster iteration):

```yaml
post-service:
  volumes:
    - ./post-service/src:/app/src  # Mount source code
  # nodemon detects changes and restarts
```

---

## Production Considerations

### Before deploying to production:

1. **Environment variables**:
   - Change `JWT_SECRET` to random 64-char string
   - Set real Cloudinary credentials
   - Use production database credentials

2. **Port exposure**:
   - Remove infrastructure ports from docker-compose
   - Use reverse proxy (Nginx) for TLS
   - Only expose port 80/443

3. **Logging**:
   - Configure centralized logging (ELK, Splunk)
   - Set `LOG_LEVEL=info` (not debug)

4. **Secrets management**:
   - Use Docker Secrets (Swarm) or Kubernetes Secrets
   - Don't commit `.env` files to git

5. **Resource limits**:
   ```yaml
   services:
     post-service:
       deploy:
         resources:
           limits:
             cpus: '1'
             memory: 512M
   ```

6. **Monitoring**:
   - Add Prometheus for metrics
   - Add Grafana for dashboards
   - Configure alerts for failed health checks

---

## Commands Summary

```bash
# Lifecycle
docker-compose up -d              # Start all
docker-compose down               # Stop all
docker-compose restart            # Restart all
docker-compose ps                 # Status

# Building
docker-compose build              # Build all images
docker-compose build --no-cache   # Force rebuild

# Logs & Debugging
docker-compose logs -f            # All logs
docker-compose logs -f service    # Service logs
docker-compose exec service sh    # Shell into container
docker-compose stats              # Resource usage

# Cleanup
docker-compose down -v            # Remove volumes
docker volume prune               # Clean orphaned
docker system prune               # Clean all unused
```
