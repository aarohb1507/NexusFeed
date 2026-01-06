# NexusFeed Containerization Architecture

## Overview
This document outlines the containerization design for NexusFeed microservices, including Docker image strategy, container networking, and service communication patterns.

---

## 1. Image Build Strategy

### Multi-Stage Build Philosophy
Each service uses a **two-stage Dockerfile**:
- **Stage 1 (Builder)**: Installs all dependencies (including devDependencies)
- **Stage 2 (Runtime)**: Copies only production dependencies and source code

**Benefits**:
- Smaller final image size (~150-180MB vs ~400MB)
- Reduced attack surface (no build tools in production)
- Consistent base image across all services
- Faster deployment pulls

### Base Image
- **Image**: `node:18-alpine`
- **Why Alpine**: 
  - 40MB base vs 300MB+ full Node
  - Security patches applied regularly
  - Lightweight for microservices

### Layer Caching Strategy
```
Layer 1: Alpine base (cached across all services)
Layer 2: npm dependencies (cached per service if package.json unchanged)
Layer 3: Application code (changes frequently, good isolation)
```

---

## 2. Service Image Architecture

### Per-Service Dockerfiles (5 total)
Each service gets an identical Dockerfile template with service-specific port exposure:

```
├── api-gateway
│   └── Dockerfile (EXPOSE 3000)
├── identity-service
│   └── Dockerfile (EXPOSE 3001)
├── post-service
│   └── Dockerfile (EXPOSE 3002)
├── media-service
│   └── Dockerfile (EXPOSE 3003)
└── search-service
    └── Dockerfile (EXPOSE 3004)
```

### Key Dockerfile Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| **User Privilege** | `node:node` (non-root) | Security best practice |
| **Port Exposure** | Individual per service | Network isolation design |
| **Health Checks** | Included | Container orchestration readiness |
| **Environment** | Node.js production | Security, performance |
| **Logging** | STDOUT/STDERR | Docker logs integration |

---

## 3. Container Networking Architecture

### Network Type
- **Driver**: `bridge` (default custom bridge)
- **Name**: `nexusfeed-network`
- **Isolation**: Services communicate via container names (internal DNS)

### Service-to-Service Communication

```
┌─────────────────────────────────────────────┐
│       nexusfeed-network (bridge)            │
├─────────────────────────────────────────────┤
│                                             │
│  api-gateway (3000) ──┐                     │
│                       ├──> identity-service │
│                       ├──> post-service     │
│                       ├──> media-service    │
│                       └──> search-service   │
│                                             │
│  RabbitMQ (5672) ◄────┬─── post-service    │
│                       ├─── media-service   │
│                       └─── search-service  │
│                                             │
│  MongoDB (27017) ◄────┬─── all services    │
│  Redis (6379) ◄───────┴─── gateway/all     │
│                                             │
└─────────────────────────────────────────────┘
```

### DNS Resolution
- Services discover each other via container name (e.g., `http://post-service:3002`)
- Docker's embedded DNS resolver handles `service-name:port` lookups
- No external service discovery needed for this scale

### Network Policies
- **Ingress**: Only API Gateway (3000) exposed to host
- **Internal**: All service-to-service traffic on bridge
- **Isolation**: Services cannot talk to external IPs unless explicitly configured

---

## 4. Service Communication Contracts

### Request Flow (HTTP/REST)
```
Client Request
    │
    ▼
┌─────────────────────────────┐
│   API Gateway (3000)        │ Rate limiting, auth validation
│   (api-gateway-container)   │
└──────────┬──────────────────┘
           │
    ┌──────┴──────────┬──────────────────┐
    │                 │                  │
    ▼                 ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Identity Svc │ │ Post Svc     │ │ Media Svc    │
│ (3001)       │ │ (3002)       │ │ (3003)       │
│ jwt validate │ │ cache layer  │ │ file upload  │
└──────────────┘ └──────────────┘ └──────────────┘
    │                 │                  │
    └─────────────────┴──────────────────┘
                 │
                 ▼
          RabbitMQ (5672)
       (async event queue)
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌─────────┐ ┌──────────┐ ┌──────────┐
│ Media   │ │ Search   │ │ Cache    │
│ Handler │ │ Handler  │ │ Invalidation
└─────────┘ └──────────┘ └──────────┘
    │            │
    ▼            ▼
 MongoDB    Denormalized
            Search Index
```

### Synchronous Communication (Gateway → Services)
- **Protocol**: HTTP/REST via proxy
- **Timeout**: 30s (configurable)
- **Error Handling**: 
  - 5xx errors → return to client
  - Connection timeout → circuit breaker pattern
- **Port Mapping**: 
  - Gateway receives on :3000
  - Routes to internal service addresses
  - Example: `/v1/posts/*` → `http://post-service:3002/api/posts/*`

### Asynchronous Communication (Event-Driven)
- **Protocol**: RabbitMQ AMQP
- **Exchange**: `facebook_events` (topic-based)
- **Message Format**: JSON with routing keys

**Event Types**:
```
post.created      → post-service publishes
                     ├─→ search-service listens (indexing)
                     └─→ media-service listens (metadata link)

post.deleted      → post-service publishes
                     ├─→ search-service listens (index cleanup)
                     └─→ media-service listens (media cleanup)

media.uploaded    → media-service publishes
                     └─→ post-service listens (associate media)

search.indexed    → search-service publishes
                     └─→ post-service listens (cache update)
```

### Data Layer Communication

**MongoDB**:
- Each service connects to shared MongoDB instance
- Connection string: `mongodb://mongo:27017/nexusfeed`
- Each service may have its own database or collection namespace

**Redis**:
- API Gateway: Rate limiting storage
- Post Service: Query result caching
- Search Service: Result caching
- Connection: `redis://redis:6379`

---

## 5. Docker Compose Architecture

### Service Orchestration

```yaml
version: '3.9'
services:
  # Infrastructure Tier
  mongo:        # Database (port 27017)
  redis:        # Cache (port 6379)
  rabbitmq:     # Message broker (port 5672)
  
  # Application Tier
  api-gateway:      # Port 3000 (exposed to host)
  identity-service: # Port 3001 (internal only)
  post-service:     # Port 3002 (internal only)
  media-service:    # Port 3003 (internal only)
  search-service:   # Port 3004 (internal only)

volumes:
  mongo-data:    # Persistent database
  redis-data:    # Persistent cache
  rabbitmq-data: # Persistent queues

networks:
  nexusfeed-network: # Single bridge network for all services
```

### Container Startup Order & Dependencies

**Dependency Chain** (using `depends_on: condition`):
```
1. mongo (MongoDB) — readiness: mongosh -eval "db.adminCommand('ping')"
2. redis (Redis) — readiness: redis-cli ping
3. rabbitmq (RabbitMQ) — readiness: rabbitmqctl status

4. identity-service — depends on: mongo
5. post-service — depends on: mongo, redis, rabbitmq
6. media-service — depends on: mongo, rabbitmq
7. search-service — depends on: mongo, redis, rabbitmq

8. api-gateway — depends on: all services (last)
```

**Rationale**: Infrastructure must be ready before services; services before gateway.

### Environment Injection

Services receive environment variables from `.env.docker`:
```
# Internal service URLs (within bridge network)
IDENTITY_SERVICE_URL=http://identity-service:3001
POST_SERVICE_URL=http://post-service:3002
MEDIA_SERVICE_URL=http://media-service:3003
SEARCH_SERVICE_URL=http://search-service:3004

# Database URLs (internal container DNS)
MONGODB_URI=mongodb://mongo:27017/nexusfeed
REDIS_URL=redis://redis:6379

# Message Queue
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
```

---

## 6. Port Exposure Strategy

### Host Port Mapping
```
Host:Container
─────────────
3000:3000   → API Gateway (only public-facing port)

(Internally on bridge network, all others accessible by name)
```

### Rationale
- **Single Exposure Point**: Only API Gateway to host
- **Service Discovery**: Other services found via container DNS
- **Security**: No direct container port exposure for internal services
- **Load Balancing**: Ready for reverse proxy or load balancer in front of 3000

---

## 7. Volume Management

### Persistence Strategy

| Service | Volume | Purpose | Lifetime |
|---------|--------|---------|----------|
| MongoDB | `mongo-data` | User + Post data | Persistent across restarts |
| Redis | `redis-data` | Cache + Rate limits | Can be ephemeral, but persisted for consistency |
| RabbitMQ | `rabbitmq-data` | Message queue | Persistent to prevent message loss |
| Services | None | Stateless containers | Recreated on restart |

### Volume Drivers
- **Type**: Named volumes (managed by Docker)
- **Location**: `/var/lib/docker/volumes/` on host
- **Backup**: Standard Docker backup/restore procedures apply

---

## 8. Health Checks & Liveness

### Container Health Checks
Each service Dockerfile includes:
```
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3
  CMD curl -f http://localhost:PORT/health || exit 1
```

**Health Endpoint Contract**:
```
GET /health
Response: { "status": "ok", "service": "post-service" }
HTTP 200
```

### Docker Compose Health Monitoring
Compose file specifies:
- Interval: 30 seconds
- Timeout: 10 seconds
- Start period: 5 seconds (grace before checking)
- Retries: 3 failures before restart

---

## 9. Build & Push Workflow

### Local Development
```bash
docker-compose build --no-cache              # Rebuild all images
docker-compose up -d                         # Start all containers
docker-compose logs -f api-gateway          # Watch logs
docker-compose down -v                      # Cleanup + volumes
```

### CI/CD Pipeline (Future)
```
Trigger: Push to main branch
  1. Build images with tag: nexusfeed:SERVICE:$VERSION
  2. Scan for vulnerabilities: trivy scan
  3. Push to registry (Docker Hub / ECR / private registry)
  4. Update docker-compose.yml with new tag versions
  5. Deploy to staging/production
```

### Image Naming Convention
```
nexusfeed-api-gateway:1.0.0
nexusfeed-identity-service:1.0.0
nexusfeed-post-service:1.0.0
nexusfeed-media-service:1.0.0
nexusfeed-search-service:1.0.0
```

---

## 10. Scaling Considerations

### Horizontal Scaling (Future)
Current compose file is single-instance. For scaling:

```yaml
# Multiple post-service instances
post-service:
  deploy:
    replicas: 3  # 3 replicas behind load balancer

# Load Balancer (Nginx)
nginx:
  ports:
    - "80:80"
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf
  depends_on:
    - api-gateway
```

### Vertical Scaling
Adjust resource limits per service:
```yaml
services:
  post-service:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

---

## 11. Network Security

### Internal Communication Flow
```
┌─ Ingress (0.0.0.0:3000 → Host → Bridge)
│
├─ Intra-bridge communication (all services)
│  ├─ Gateway → Identity (JWT validation)
│  ├─ Gateway → Post (CRUD operations)
│  ├─ Gateway → Media (upload handling)
│  ├─ Gateway → Search (query handling)
│  └─ All → RabbitMQ (event publishing/consuming)
│
└─ Egress (to Cloudinary API, external services)
```

### Future Hardening
- Network policies (if using Docker Swarm/Kubernetes)
- Certificate-based mTLS between services
- API Gateway as reverse proxy with TLS termination
- Service mesh (Istio) for production

---

## 12. Logging & Monitoring Strategy

### Log Aggregation
All containers log to STDOUT/STDERR (collected by Docker):
```bash
docker-compose logs services        # View all logs
docker-compose logs -f post-service # Follow post-service
```

### Log Driver (Default: json-file)
For production, consider:
- ELK Stack (Elasticsearch, Logstash, Kibana)
- Splunk
- CloudWatch (AWS)
- Datadog

### Environment-based Logging
```
Development: LOG_LEVEL=debug   (verbose)
Production: LOG_LEVEL=info     (standard)
```

---

## 13. Environment Configuration

### Multi-Environment Support
```
├── .env.docker          # Development (Docker)
├── .env.docker.staging  # Staging environment
├── .env.docker.prod     # Production environment
```

### Secret Management (Future)
Current: `.env` files in compose
Production: 
- Docker Secrets (Swarm mode)
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets

---

## Summary: Design Principles

| Principle | Implementation |
|-----------|-----------------|
| **Modularity** | Each service independent, own container |
| **Scalability** | Stateless containers, centralized data layer |
| **Resilience** | Health checks, restart policies, message queue reliability |
| **Observability** | STDOUT logging, health endpoints, metrics ready |
| **Security** | Non-root users, network isolation, variable injection |
| **Simplicity** | Single docker-compose file, no external tools needed for dev |

---

## Next Steps

1. ✅ Create Dockerfiles for each service
2. ✅ Create docker-compose.yml orchestration
3. ✅ Create .env.docker configuration
4. 🔄 Add CI/CD pipeline (GitHub Actions)
5. 🔄 Deploy to cloud (AWS/GCP/Azure)
6. 🔄 Add monitoring stack (Prometheus, Grafana)
7. 🔄 Implement service mesh (Istio)
