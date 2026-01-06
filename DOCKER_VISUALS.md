# Containerization Design: Visual Guides & Diagrams

## 1. Image Build Pipeline

```
┌─────────────────────────────────────────────────────────┐
│  Source Code + package.json                             │
│  (All 5 services: api-gateway/, post-service/, etc.)   │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  docker-compose build        │
        │  (Dockerfile parsing)        │
        └──────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
    ┌─────────────────────┐   ┌─────────────────────┐
    │ STAGE 1: Builder    │   │ STAGE 2: Runtime    │
    │ (Full environment)  │   │ (Production-only)   │
    ├─────────────────────┤   ├─────────────────────┤
    │ • node:18-alpine    │   │ • node:18-alpine    │
    │ • npm ci (all deps) │   │ • npm ci (prod only)│
    │ • source code       │   │ • source code       │
    │ • build tools       │   │ • NO build tools    │
    │ • ~400MB            │   │ • ~165MB            │
    └──────────┬──────────┘   └──────────┬──────────┘
               │ (copied)                │
               │ node_modules            │ Final image
               └────────────────┬────────┘
                                │
                        ┌───────▼────────┐
                        │ Docker Registry │
                        │ (local or hub)  │
                        └─────────────────┘
```

### Build Commands Timeline
```
T=0s    docker-compose build --no-cache
        ├─ Pull base images: node:18-alpine
        │
T=5s    Build stage 1 (builder) × 5 services
        ├─ Each installs node_modules (~2s per service)
        │
T=20s   Build stage 2 (runtime) × 5 services
        ├─ Each copies optimized layers
        │
T=30s   Build complete
        ├─ 5 images created (~165MB each)
        ├─ Ready for docker-compose up
```

---

## 2. Container Networking Visualization

### Docker Bridge Network Topology

```
┌─────────────────────────── Host Machine ──────────────────────────┐
│                                                                   │
│  Internet                                                         │
│    │                                                              │
│    └──→ Port 3000 (open to host)                                 │
│           │                                                       │
│           ▼                                                       │
│    ┌─────────────────────────────────────────────────────────┐  │
│    │  Docker Port Mapper (NAT)                               │  │
│    │  127.0.0.1:3000 ↔ nexusfeed-api-gateway 172.19.0.2:3000│  │
│    └──────────────┬────────────────────────────────────────┘  │
│                   │                                              │
│    ┌──────────────┘                                              │
│    │                                                              │
│    ▼  Docker bridge translation                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  nexusfeed-network (bridge driver)                         │ │
│  │  Bridge IP: 172.19.0.1                                     │ │
│  │                                                            │ │
│  │  172.19.0.2   ┌────────────────────────────────┐          │ │
│  │    (api-gw)   │ api-gateway:3000               │          │ │
│  │      ←─────── │ • Express.js                   │          │ │
│  │      │        │ • Rate limiter                 │          │ │
│  │      │        │ • Auth middleware              │          │ │
│  │      │        └────────────────────────────────┘          │ │
│  │      │                 │                                   │ │
│  │      │   ┌─────────────┼─────────────┬──────────┐         │ │
│  │      │   │             │             │          │         │ │
│  │      │   ▼             ▼             ▼          ▼         │ │
│  │      │ 172.19.0.3  172.19.0.4   172.19.0.5  172.19.0.6   │ │
│  │      │ Identity    Post         Media       Search        │ │
│  │      │ :3001       :3002        :3003       :3004         │ │
│  │      │                                                    │ │
│  │      ├──────────────┐  ┌───────────────────┐             │ │
│  │      │              │  │                   │             │ │
│  │      ▼              ▼  ▼                   ▼             │ │
│  │    172.19.0.7   172.19.0.8         172.19.0.9           │ │
│  │    MongoDB      Redis              RabbitMQ              │ │
│  │    :27017       :6379              :5672                 │ │
│  │                                                            │ │
│  │  DNS Resolution (Docker embedded DNS 127.0.0.11:53):     │ │
│  │  ┌──────────────────────────────────────────────────┐    │ │
│  │  │ post-service  → 172.19.0.4:3002                │    │ │
│  │  │ identity-service → 172.19.0.3:3001             │    │ │
│  │  │ mongo → 172.19.0.7:27017                       │    │ │
│  │  │ redis → 172.19.0.8:6379                        │    │ │
│  │  │ rabbitmq → 172.19.0.9:5672                     │    │ │
│  │  └──────────────────────────────────────────────────┘    │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

Key Points:
1. Only port 3000 exposed to host (api-gateway)
2. All other services communicate via bridge network
3. Service names resolved to IPs via Docker DNS
4. No need to hardcode IPs in code
```

### Request Journey Through Network

```
Client                    Host Machine              Docker Network
━━━━━━                    ════════════              ══════════════
 │
 │ HTTP Request
 │ GET /v1/posts
 │ Host: localhost:3000
 │
 ├──────────────────────→ Port 3000 listener
 │                        (iptables NAT rule)
 │                        localhost:3000:172.19.0.2:3000
 │                        │
 │                        └───────→ Bridge Network
 │                                  │
 │                                  ▼
 │                            api-gateway
 │                            172.19.0.2:3000
 │                                  │
 │                        ┌─────────┴─────────┐
 │                        │                   │
 │                 Check rate limit      Route request
 │                   (Redis)            (http-proxy)
 │                        │                   │
 │                    172.19.0.8:6379    POST  → http://post-service:3002
 │                        │              (DNS resolves to 172.19.0.4)
 │                        │                   │
 │                        └─────────┬─────────┘
 │                                  │
 │                                  ▼
 │                            post-service
 │                            172.19.0.4:3002
 │                                  │
 │                            Query Database
 │                                  │
 │                                  ▼
 │                            mongodb
 │                            172.19.0.7:27017
 │                                  │
 │                            Response back
 │                                  ├─────→ post-service
 │                                  │       ├─────→ api-gateway
 │                                  │              └─────→ Port 3000
 │                                  │
 └──────────────────────────────────┘
 
 Response: 200 OK + posts data
```

---

## 3. Service Initialization Sequence

```
Time    Component           State              Action
────    ─────────────────   ──────────────────  ────────────────────────
0s      docker-compose     created            Build network, volumes
        
1s      mongo              starting           Pulling image, creating container
        redis              starting           Pulling image, creating container
        rabbitmq           starting           Pulling image, creating container
        
5s      mongo              ready but not      Database process booting,
                           accepting          listening on 27017
        redis              ready but not      Redis process booting,
                           accepting          listening on 6379
        rabbitmq           ready but not      RabbitMQ process booting,
                           accepting          listening on 5672
        
10s     mongo              health check 1     mongosh: success ✓
        redis              health check 1     redis-cli: success ✓
        rabbitmq           health check 1     rabbitmq-diag: success ✓
        
15s     mongo              healthy            Healthy state registered
        redis              healthy            Healthy state registered
        rabbitmq           healthy            Healthy state registered
        
        Trigger dependent services (depends_on: condition: service_healthy)
        
16s     identity-service   starting           Wait for mongo to be healthy
        post-service       starting           Wait for mongo, redis, rabbitmq
        media-service      starting           Wait for mongo, rabbitmq
        search-service     starting           Wait for mongo, redis, rabbitmq
        
20s     identity-service   initializing       Connecting to mongo
        post-service       initializing       Connecting to mongo, redis, rabbitmq
        media-service      initializing       Connecting to mongo, rabbitmq
        search-service     initializing       Connecting to mongo, redis, rabbitmq
        
25s     identity-service   ready              Express listening on :3001
        post-service       ready              Express listening on :3002
        media-service      ready              Express listening on :3003
        search-service     ready              Express listening on :3004
        
30s     identity-service   health check 1     /health endpoint: success ✓
        post-service       health check 1     /health endpoint: success ✓
        media-service      health check 1     /health endpoint: success ✓
        search-service     health check 1     /health endpoint: success ✓
        
45s     identity-service   healthy            Healthy state registered
        post-service       healthy            Healthy state registered
        media-service      healthy            Healthy state registered
        search-service     healthy            Healthy state registered
        
        Trigger dependent services
        
46s     api-gateway        starting           Wait for all to be healthy
        
50s     api-gateway        initializing       Connecting to redis
        
55s     api-gateway        ready              Express listening on :3000
        
60s     api-gateway        health check 1     /health endpoint: success ✓
        
65s     api-gateway        healthy            Healthy state registered
        
        ✅ STACK READY FOR REQUESTS
```

**Key insight**: Services don't start in parallel; they wait for dependencies

---

## 4. Data Flow: Create Post Example

```
CLIENT (Browser)
    │
    │ POST /v1/posts/create-post
    │ {
    │   "content": "Hello World",
    │   "mediaIds": ["media-123"]
    │ }
    │
    ▼
API Gateway:3000 (172.19.0.2)
    ├─ [T+0ms] Receives request
    ├─ [T+1ms] Rate limit check
    │   └─→ Redis: GET rate_limit:ip_address
    │       └─→ 172.19.0.8:6379 (redis:6379)
    │       └─ Response: 45/100 requests used ✓
    │
    ├─ [T+3ms] JWT validation
    │   └─→ Extract token from Authorization header
    │   └─ Decode & verify using JWT_SECRET
    │   └─ Extract userId
    │
    ├─ [T+5ms] Route to post-service
    │   └─ URL rewrite: /api/posts/create-post
    │   └─ Proxy to http://post-service:3002
    │       ↓ (Docker DNS: post-service → 172.19.0.4)
    │
    ▼
Post Service:3002 (172.19.0.4)
    ├─ [T+10ms] Receives request
    ├─ [T+12ms] Validate request
    │   └─ Joi schema: { content (required), mediaIds (optional) }
    │   └─ Response: valid ✓
    │
    ├─ [T+14ms] Query database
    │   └─→ MongoDB: db.posts.insertOne({
    │       userId: "user-123",
    │       content: "Hello World",
    │       mediaIds: ["media-123"],
    │       createdAt: new Date()
    │   })
    │   └─→ 172.19.0.7:27017 (mongo:27017)
    │   └─ Response: inserted, _id: "post-789" ✓
    │
    ├─ [T+25ms] Publish event
    │   └─ Topic: post.created
    │   └─ Message:
    │       {
    │         postId: "post-789",
    │         userId: "user-123",
    │         content: "Hello World",
    │         mediaIds: ["media-123"],
    │         timestamp: "2024-01-15T10:30:00Z"
    │       }
    │   └─→ RabbitMQ: 172.19.0.9:5672 (rabbitmq:5672)
    │   └─ Response: queued ✓
    │
    ├─ [T+27ms] Invalidate cache
    │   └─→ Redis: DEL posts:* (clear all pagination caches)
    │   └─→ 172.19.0.8:6379
    │   └─ Response: keys deleted ✓
    │
    ├─ [T+29ms] Send response to Gateway
    │   └─ HTTP 201 Created
    │   └─ Body: {
    │       postId: "post-789",
    │       userId: "user-123",
    │       content: "Hello World",
    │       createdAt: "2024-01-15T10:30:00Z"
    │   }
    │
    ▼
API Gateway:3000
    ├─ [T+32ms] Receives response from post-service
    ├─ [T+33ms] Forward to client
    │
    ▼
CLIENT (Browser)
    │ [T+35ms] Response: 201 Created ✓
    │
    └─ Display "Post created!"
    
[MEANWHILE - ASYNCHRONOUS]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Search Service (172.19.0.6) - Listening to RabbitMQ
    │ [T+25ms] Receives post.created event
    ├─ [T+28ms] Parse message
    ├─ [T+30ms] Insert into Search collection
    │   └─→ MongoDB: db.search.insertOne({
    │       postId: "post-789",
    │       userId: "user-123",
    │       content: "Hello World",
    │       createdAt: ...
    │   })
    │   └─→ 172.19.0.7:27017
    │
    ├─ [T+40ms] Create text index
    │   └─ MongoDB text index on 'content' field
    │
    ├─ [T+42ms] Invalidate cache
    │   └─→ Redis: DEL search:*
    │
    └─ [T+45ms] Acknowledge message to RabbitMQ
        └─ Message successfully processed ✓

Media Service (172.19.0.5) - Listening to RabbitMQ
    │ [T+25ms] Receives post.created event
    ├─ [T+28ms] Parse message, extract mediaIds
    ├─ [T+30ms] For each mediaId:
    │   └─ Update: db.media.updateOne(
    │       { _id: "media-123" },
    │       { $set: { postId: "post-789" } }
    │   )
    │   └─→ 172.19.0.7:27017
    │
    └─ [T+40ms] Acknowledge message to RabbitMQ
        └─ Message successfully processed ✓

[RESULT]
Total sync time: ~35ms (to client)
Total async time: ~45ms (indexing + linking)
All services eventually consistent within 100ms
```

---

## 5. Failure Scenario: Service Crash

```
Normal State:
POST:3002 ✓ Healthy
  └─ Health checks: passing every 30s
  └─ Container: running

Crisis: POST Service crashes
  │
  ├─ [T+0ms] post-service process crashes
  │
  ├─ [T+1ms] Docker daemon detects crash
  │
  ├─ [T+2ms] Health check triggered (interval: 30s, but also on death)
  │
  ├─ [T+3ms] Health check fails (container dead)
  │           └─ Failure #1
  │
  ├─ [T+40s] Health check #2 (interval: 30s)
  │           └─ Still dead
  │           └─ Failure #2
  │
  ├─ [T+70s] Health check #3
  │           └─ Still dead
  │           └─ Failure #3 (retries exceeded: 3)
  │
  └─ [T+75ms] Docker restarts container
      ├─ Kill old process (already dead)
      ├─ Spawn new container
      ├─ [T+5s] Grace period (start_period: 5s, no health checks)
      ├─ [T+10s] First health check of new container
      │           └─ Might be up or still initializing
      ├─ [T+15s] Health check #2
      │           └─ Database connection establishing
      ├─ [T+20s] Health check #3
      │           └─ Express server ready ✓
      │           └─ Health check succeeds
      ├─ [T+25s] Container marked healthy again
      │
      └─ Service back to normal

Clients during crash (while unhealthy):
  POST /v1/posts/... → API Gateway
    → post-service:3002 (DNS works, but connection refused)
    → API Gateway returns: 503 Service Unavailable
    → Client gets error (may retry or fallback)

When service recovers:
  → API Gateway health check: still healthy
  → POST requests start working again
  → No manual intervention needed
```

---

## 6. Resource Constraints (Memory/CPU)

### Current (No limits)
```yaml
api-gateway:
  # No resource limits specified
  # Can use unlimited CPU and memory
  # Risk: One service eats all host resources
```

### With Limits (Recommended)
```yaml
post-service:
  deploy:
    resources:
      limits:
        cpus: '1'        # Max 1 CPU core
        memory: 512M     # Max 512MB RAM
      reservations:
        cpus: '0.5'      # Request 0.5 cores
        memory: 256M     # Request 256MB
```

**Behavior**:
```
Memory usage by service:
├─ post-service: 256MB (reserved) → 512MB (limit)
├─ search-service: 256MB → 512MB
├─ api-gateway: 128MB → 256MB
├─ identity-service: 128MB → 256MB
├─ media-service: 128MB → 256MB
└─ Total: 1024MB reserved, 2048MB max

If service exceeds limit:
  └─ Docker OOMKill (out of memory kill)
  └─ Container exits
  └─ Restart policy kicks in
  └─ Container restarted
```

---

## 7. Network Isolation Security

```
Without Custom Bridge (default Docker bridge):
┌─ All containers on default bridge
├─ All can communicate with each other
├─ Less isolation between untrusted workloads
└─ Environment variables visible in `docker inspect`

With Custom Bridge (current design):
┌─ nexusfeed-network isolated from other networks
├─ Only containers attached to network can communicate
├─ External containers cannot reach network
├─ Better security boundary
└─ Environment variables still visible to Docker runtime (use secrets for prod)

Even better (Production):
├─ Remove service ports from docker-compose
├─ Only expose api-gateway:3000
├─ Use secrets management for sensitive data
└─ Add TLS between containers (mTLS)
```

---

## 8. Persistence: Data Lifecycle

```
docker-compose up -d
    │
    ├─ Create mongo-data volume
    │  └─ /var/lib/docker/volumes/nexusfeed_mongo-data/_data
    │
    ├─ Create redis-data volume
    │  └─ /var/lib/docker/volumes/nexusfeed_redis-data/_data
    │
    └─ Create rabbitmq-data volume
       └─ /var/lib/docker/volumes/nexusfeed_rabbitmq-data/_data

Services running
    ├─ Post created → MongoDB (written to mongo-data volume)
    ├─ Cache set → Redis (written to redis-data volume)
    └─ Message published → RabbitMQ (written to rabbitmq-data volume)

docker-compose down
    │ Containers stop, volumes persist
    └─ Data still in:
       ├─ /var/lib/docker/volumes/nexusfeed_mongo-data/_data
       ├─ /var/lib/docker/volumes/nexusfeed_redis-data/_data
       └─ /var/lib/docker/volumes/nexusfeed_rabbitmq-data/_data

docker-compose up -d (second time)
    └─ Volumes remounted
    └─ Data restored
    └─ All posts, cache, messages intact ✓

docker-compose down -v
    │ Containers stop, volumes deleted
    └─ ALL DATA LOST
       ├─ Posts deleted
       ├─ Cache cleared
       └─ Messages lost

docker volume ls
    ├─ nexusfeed_mongo-data
    ├─ nexusfeed_redis-data
    └─ nexusfeed_rabbitmq-data

docker volume inspect nexusfeed_mongo-data
    └─ Shows location: /var/lib/docker/volumes/nexusfeed_mongo-data/_data

Backup data:
    tar -czf backup.tar.gz /var/lib/docker/volumes/nexusfeed_*
```

---

## Summary: Key Design Decisions

| Decision | Why |
|----------|-----|
| **Multi-stage Dockerfile** | Reduce image size 57%, fewer vulnerabilities |
| **Alpine base** | 40MB vs 300MB+, faster pulls, less attack surface |
| **Non-root user** | Limit damage if container compromised |
| **Health checks** | Auto-recovery without manual intervention |
| **Bridge network** | Isolation, DNS-based service discovery |
| **Only port 3000 exposed** | Security, single entry point, scalable |
| **Named volumes** | Persistence across restarts, backup-friendly |
| **Stateless services** | Scale horizontally without coordination |
| **Event-driven async** | Loose coupling, resilient to failures |
| **Dependency conditions** | Correct startup order, services ready before use |

