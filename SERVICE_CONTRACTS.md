# Communication Contracts & Service Dependencies

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         External Clients                                │
│              (Browser, Mobile App, API Consumers)                       │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              │ HTTP/HTTPS
                              │ localhost:3000
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     API GATEWAY (3000)                                  │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ • Request routing & validation                                    │ │
│  │ • Rate limiting (Redis-backed)                                    │ │
│  │ • JWT token validation                                            │ │
│  │ • Request/response logging                                        │ │
│  │ • CORS & Security headers (Helmet)                               │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          │                    │                    │
    HTTP │                HTTP │              HTTP │
         │                     │                    │
         ▼                     ▼                    ▼
    ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
    │  IDENTITY   │   │     POST     │   │    MEDIA     │
    │  SERVICE    │   │    SERVICE   │   │   SERVICE    │
    │   (3001)    │   │   (3002)     │   │   (3003)     │
    ├─────────────┤   ├──────────────┤   ├──────────────┤
    │ •JWT tokens │   │ •CRUD posts  │   │ •File upload │
    │ •User login │   │ •Caching     │   │ •Cloudinary  │
    │ •Validation │   │ •Validation  │   │ •Media meta  │
    └─────────────┘   └──────────────┘   └──────────────┘
         │                 │ │                  │
         │                 │ │                  │
         └────────┬────────┘ │                  │
                  │          │ ┌─────┬──────────┘
                  │          │ │
                  │          │ │
              HTTP│          │ │ HTTP
                  │          │ │
                  ▼          ▼ ▼
    ┌──────────────────────────────────────┐
    │        SEARCH SERVICE (3004)         │
    ├──────────────────────────────────────┤
    │ •Full-text search                    │
    │ •Event-driven indexing               │
    │ •Query caching                       │
    └──────────────────────────────────────┘
         │     │      │
    Topic│     │ Topic│
         │     │      │
         ▼     ▼      ▼
    ┌─────────────────────────────┐
    │  RabbitMQ (5672)            │
    │  Topic Exchange: facebook_  │
    │  events                     │
    │  (Event message broker)     │
    └─────────────────────────────┘
         │     │      │      │
         │ Topic│  Topic│ Topic│
         │     │      │      │
    ┌────▼──┐ │  ┌────▼──┐  │  (post.created,
    │ POST  │ │  │ MEDIA │  │   post.deleted,
    │ SRVCE │ │  │ SRVCE │  │   media.upload)
    │ sub  │◄┘  │ sub  │◄──┘
    └──────┘    └──────┘
         │            │        │
    POST │       Mongo│        │ Redis
         │            │        │
         ▼            ▼        ▼
    ┌──────────────────────────────────────────┐
    │       PERSISTENT DATA LAYER              │
    ├──────────────────────────────────────────┤
    │                                          │
    │  MongoDB (27017)      Redis (6379)      │
    │  ├─ Users             ├─ Rate limits    │
    │  ├─ Posts             ├─ Cache:posts    │
    │  ├─ Media             ├─ Cache:search   │
    │  └─ Search Index      └─ Session data   │
    │                                          │
    └──────────────────────────────────────────┘
```

---

## Service Dependency Matrix

```
                 API-GW  Identity  Post  Media  Search  Mongo  Redis  AMQP
├─────────────────────────────────────────────────────────────────────────
API Gateway      -        HTTP      HTTP   HTTP   HTTP    -      ✓      -
Identity Service -        -         -      -      -       ✓      -      -
Post Service     -        (opt)     -      AMQP   AMQP    ✓      ✓      ✓
Media Service    -        (opt)     AMQP   -      AMQP    ✓      -      ✓
Search Service   -        (opt)     AMQP   -      -       ✓      ✓      ✓

Legend:
✓ = Direct connection required
- = No direct connection
HTTP = Synchronous REST API call
AMQP = Asynchronous message queue
(opt) = Optional (for validation, not required for operation)
```

---

## HTTP Contract: Request/Response Patterns

### Auth Service Contract

**Endpoint**: `POST /api/auth/register`
```
REQUEST:
─────────────────────────────
POST /api/auth/register HTTP/1.1
Host: identity-service:3001
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "hashed_password"
}

RESPONSE (201):
─────────────────────────────
{
  "success": true,
  "user": {
    "userId": "uuid-123",
    "email": "user@example.com"
  },
  "token": "eyJhbGc...",
  "refreshToken": "refresh-token-xyz"
}

RESPONSE (400):
─────────────────────────────
{
  "success": false,
  "error": "Email already registered"
}
```

**Endpoint**: `POST /api/auth/login`
```
REQUEST:
─────────────────────────────
POST /api/auth/login HTTP/1.1
Host: identity-service:3001
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}

RESPONSE (200):
─────────────────────────────
{
  "success": true,
  "token": "eyJhbGc...",
  "refreshToken": "refresh-token-xyz",
  "expiresIn": "15m"
}
```

**Endpoint**: `POST /api/auth/validate-token` (Internal)
```
REQUEST:
─────────────────────────────
POST /api/auth/validate-token HTTP/1.1
Host: identity-service:3001
Content-Type: application/json

{
  "token": "eyJhbGc..."
}

RESPONSE (200):
─────────────────────────────
{
  "success": true,
  "userId": "user-123",
  "email": "user@example.com"
}

RESPONSE (401):
─────────────────────────────
{
  "success": false,
  "error": "Invalid or expired token"
}
```

---

### Post Service Contract

**Endpoint**: `POST /api/posts/create-post`
```
REQUEST:
─────────────────────────────
POST /api/posts/create-post HTTP/1.1
Host: post-service:3002
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "content": "Hello World!",
  "mediaIds": ["media-123", "media-456"]
}

RESPONSE (201):
─────────────────────────────
{
  "success": true,
  "post": {
    "postId": "post-789",
    "userId": "user-123",
    "content": "Hello World!",
    "mediaIds": ["media-123", "media-456"],
    "createdAt": "2024-01-15T10:30:00Z"
  }
}

SIDE EFFECTS:
─────────────────────────────
1. Save to MongoDB: posts collection
2. Publish to RabbitMQ:
   - Topic: post.created
   - Message: { postId, userId, content, mediaIds }
3. Invalidate cache: REDIS DEL posts:*
```

**Endpoint**: `GET /api/posts/all-posts`
```
REQUEST:
─────────────────────────────
GET /api/posts/all-posts?page=1&limit=10 HTTP/1.1
Host: post-service:3002
Authorization: Bearer eyJhbGc...

RESPONSE (200):
─────────────────────────────
{
  "success": true,
  "posts": [
    {
      "postId": "post-789",
      "userId": "user-123",
      "content": "Hello World!",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "hasMore": true
  }
}

CACHE BEHAVIOR:
─────────────────────────────
1. Check Redis: GET posts:1:10 (300s TTL)
   - If hit: Return cached response
   - If miss: Query MongoDB, cache result
2. Invalidation on write: DEL posts:*
```

---

### Media Service Contract

**Endpoint**: `POST /api/media/upload`
```
REQUEST:
─────────────────────────────
POST /api/media/upload HTTP/1.1
Host: media-service:3003
Authorization: Bearer eyJhbGc...
Content-Type: multipart/form-data

[binary file data]

RESPONSE (201):
─────────────────────────────
{
  "success": true,
  "media": {
    "mediaId": "media-123",
    "userId": "user-123",
    "url": "https://res.cloudinary.com/...",
    "publicId": "cloudinary-xyz",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}

SIDE EFFECTS:
─────────────────────────────
1. Upload to Cloudinary CDN
2. Save metadata to MongoDB: media collection
3. Publish to RabbitMQ:
   - Topic: media.uploaded
   - Message: { mediaId, userId, url }
4. Listen to post.deleted:
   - Delete from Cloudinary
   - Remove from MongoDB
```

---

### Search Service Contract

**Endpoint**: `GET /api/search`
```
REQUEST:
─────────────────────────────
GET /api/search?query=keyword&page=1&limit=20 HTTP/1.1
Host: search-service:3004
Authorization: Bearer eyJhbGc...

RESPONSE (200):
─────────────────────────────
{
  "success": true,
  "results": [
    {
      "postId": "post-789",
      "userId": "user-123",
      "content": "Hello World with keyword!",
      "score": 2.5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156
  }
}

CACHE BEHAVIOR:
─────────────────────────────
1. Check Redis: GET search:keyword:1:20 (300s TTL)
   - If hit: Return cached results
   - If miss: MongoDB text search, cache result
2. Invalidation on post changes: DEL search:*
```

---

## RabbitMQ Event Contracts

### Message Format

```
Exchange: facebook_events
Type: topic
Durable: false

Message Structure:
{
  "eventType": "post.created|post.deleted|media.uploaded",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "postId": "post-789",
    "userId": "user-123",
    "content": "Hello World",
    "mediaIds": ["media-123"]
  }
}
```

### Event 1: post.created

**Publisher**: Post Service
```javascript
// After POST successfully saved to MongoDB
publishEvent('post.created', {
  postId: post._id,
  userId: post.userId,
  content: post.content,
  mediaIds: post.mediaIds
})
```

**Subscribers**:

1. **Search Service**
   ```
   Routing key: post.created
   Action: Insert into Search.collection (denormalized)
   Create text index on content field
   Result: Post now searchable
   ```

2. **Media Service**
   ```
   Routing key: post.created
   Action: Link Media documents to Post
   Update Media.postId fields
   Result: Media associated with post
   ```

**Acknowledgment Model**: Auto-ack (fire-and-forget)

---

### Event 2: post.deleted

**Publisher**: Post Service
```javascript
// After POST successfully deleted from MongoDB
publishEvent('post.deleted', {
  postId: post._id,
  userId: post.userId,
  mediaIds: post.mediaIds
})
```

**Subscribers**:

1. **Search Service**
   ```
   Routing key: post.deleted
   Action: Remove from Search.collection
   Remove from text index
   Invalidate cache: DEL search:*
   Result: Post no longer searchable
   ```

2. **Media Service**
   ```
   Routing key: post.deleted
   Action: For each mediaId:
     - Delete from Cloudinary CDN
     - Remove from Media.collection
   Invalidate cache: DEL media:*
   Result: Media files cleaned up
   ```

**Acknowledgment Model**: Manual ack (on successful cleanup)

---

### Event 3: media.uploaded

**Publisher**: Media Service
```javascript
// After file uploaded to Cloudinary
publishEvent('media.uploaded', {
  mediaId: media._id,
  userId: media.userId,
  url: media.url,
  publicId: media.publicId
})
```

**Subscribers**:

1. **Post Service** (optional)
   ```
   Routing key: media.uploaded
   Action: Notify about new media asset
   Update post if mediaIds included
   Invalidate cache: DEL posts:*
   Result: Post reflects new media
   ```

**Acknowledgment Model**: Manual ack

---

## Data Flow Examples

### Example 1: Create Post with Media

```
┌─ Client sends request
│  POST /v1/posts/create-post
│  { content: "Hello", mediaIds: ["123", "456"] }
│
├─ API Gateway (3000)
│  ├─ Rate limiter: Check Redis rate_limit:IP
│  ├─ Auth: Validate JWT token
│  └─ Route to: http://post-service:3002
│
├─ Post Service (3002) receives
│  ├─ Validate request (Joi schema)
│  ├─ Save to MongoDB: db.posts.insertOne({...})
│  ├─ Publish event to RabbitMQ:
│  │  Topic: post.created
│  │  Data: { postId, userId, content, mediaIds }
│  └─ Return: 201 Created { postId, content, ... }
│
├─ Search Service (async) receives post.created
│  ├─ Listen on RabbitMQ: post.created
│  ├─ Insert into MongoDB: db.search.insertOne({...})
│  ├─ Create text index: db.search.createIndex({ content: "text" })
│  └─ Invalidate cache: Redis DEL search:*
│
├─ Media Service (async) receives post.created
│  ├─ Listen on RabbitMQ: post.created
│  ├─ For each mediaId:
│  │  └─ Update: db.media.updateOne({_id: mediaId}, {postId})
│  └─ Acknowledge message
│
└─ Client receives response: 201 Created
```

### Example 2: Search Posts

```
┌─ Client sends request
│  GET /v1/search?query=hello
│
├─ API Gateway (3000)
│  ├─ Rate limiter: Check Redis rate_limit:IP
│  ├─ Auth: Validate JWT
│  └─ Route to: http://search-service:3004
│
├─ Search Service (3004) receives
│  ├─ Check Redis cache: GET search:hello:1:20
│  │  ├─ Cache HIT: Return cached results
│  │  └─ Cache MISS: Continue to database
│  ├─ MongoDB text search:
│  │  db.search.find({ $text: { $search: "hello" } })
│  ├─ Sort by score: { score: { $meta: "textScore" } }
│  ├─ Cache result: Redis SET search:hello:1:20 [results] EX 300
│  └─ Return: 200 OK { results, pagination }
│
└─ Client receives response: 200 OK
   Results from Redis cache (next identical query: <1ms)
```

### Example 3: Delete Post

```
┌─ Client sends request
│  DELETE /v1/posts/:postId
│
├─ API Gateway (3000)
│  ├─ Rate limiter: Check Redis rate_limit:IP
│  ├─ Auth: Validate JWT
│  └─ Route to: http://post-service:3002
│
├─ Post Service (3002) receives
│  ├─ Check ownership: user.id === post.userId
│  ├─ Delete from MongoDB: db.posts.deleteOne({_id: postId})
│  ├─ Invalidate cache: Redis DEL posts:* (all pagination caches)
│  ├─ Publish event to RabbitMQ:
│  │  Topic: post.deleted
│  │  Data: { postId, userId, mediaIds }
│  └─ Return: 200 OK { success: true }
│
├─ Search Service (async) receives post.deleted
│  ├─ Listen on RabbitMQ: post.deleted
│  ├─ Delete from MongoDB: db.search.deleteOne({postId})
│  ├─ Invalidate cache: Redis DEL search:*
│  └─ Acknowledge message
│
├─ Media Service (async) receives post.deleted
│  ├─ Listen on RabbitMQ: post.deleted
│  ├─ For each mediaId:
│  │  ├─ Delete from Cloudinary: cloudinary.uploader.destroy(publicId)
│  │  └─ Delete from MongoDB: db.media.deleteOne({_id: mediaId})
│  └─ Acknowledge message
│
└─ Client receives response: 200 OK
```

---

## Consistency Models

### Strong Consistency (Synchronous)
```
User Authentication
Post Ownership Validation
Rate Limiting

API Gateway → Identity Service (HTTP)
  └─ Block until response received
  └─ Fail if service unavailable
  └─ Response critical to operation
```

### Eventual Consistency (Asynchronous)
```
Search Indexing
Media Cleanup
Cache Invalidation

Post Service → RabbitMQ → Search Service (async)
  └─ Return immediately (fire-and-forget)
  └─ Tolerate temporary inconsistency
  └─ System self-heals on retries
  └─ Max 5-10 second delay
```

---

## Error Handling Contracts

### Network Failures (Service Unreachable)

```
GET /v1/posts/123
  ↓
API Gateway → post-service:3002 (timeout or connection refused)
  ↓
❌ Response from Gateway: 503 Service Unavailable
  {
    "success": false,
    "error": "Post service temporarily unavailable"
  }
```

### Message Queue Failures

```
Post Service publishes to RabbitMQ
  ├─ RabbitMQ available: Message queued immediately ✓
  └─ RabbitMQ unavailable:
     ├─ Retry logic (exponential backoff)
     ├─ Dead Letter Queue (DLQ) after max retries
     ├─ Manual intervention required
     └─ Post created but not indexed (eventual consistency)
```

### Database Failures

```
Create Post:
  ├─ MongoDB unavailable: Return 500 Internal Server Error
  ├─ Validation error: Return 400 Bad Request
  └─ Duplicate key: Return 409 Conflict
```

---

## Summary: Communication Patterns

| Pattern | Example | Timeout | Failure Behavior |
|---------|---------|---------|------------------|
| **Sync (HTTP)** | API → Identity | 30s | Return error to client |
| **Async (AMQP)** | Post → Search | N/A | Retry + DLQ |
| **Cache** | Redis queries | 300s TTL | Transparent fallback to DB |
| **Health Check** | Docker healthcheck | 10s | Restart container |
