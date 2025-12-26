# NexusFeed 🚀

A microservices social media platform with event-driven architecture, distributed caching, and real-time search.

## Architecture

5 microservices connected via RabbitMQ + Redis caching:
- **API Gateway** (3000) - Request routing, rate limiting
- **Identity Service** (3001) - JWT auth, refresh tokens
- **Post Service** (3002) - CRUD with Redis caching
- **Media Service** (3003) - Cloudinary CDN uploads
- **Search Service** (3004) - Full-text search with event indexing

## Tech Stack

**Backend**: Node.js, Express  
**Databases**: MongoDB, Redis  
**Message Queue**: RabbitMQ  
**Media**: Multer, Cloudinary  
**Auth**: JWT, argon2

## Features

✅ Event-driven messaging (ACK/NACK, DLQ, retries)  
✅ Pagination-aware caching with intelligent invalidation  
✅ Rate limiting (global + per-endpoint)  
✅ Full-text search with MongoDB indexing  
✅ Service independence & eventual consistency

## Quick Start

### Prerequisites
Node.js v18+, MongoDB, Redis, RabbitMQ, Cloudinary account

### Setup

```bash
# Clone and install
git clone https://github.com/yourusername/NexusFeed.git
cd NexusFeed
cd api-gateway && npm install && cd ..
cd identity-service && npm install && cd ..
cd post-service && npm install && cd ..
cd media-service && npm install && cd ..
cd search-service && npm install && cd ..

# Create .env files (see ARCHITECTURE.md for details)
# Start infrastructure: MongoDB, Redis, RabbitMQ

# Run services (5 terminals)
cd api-gateway && npm run dev
cd identity-service && npm run dev
cd post-service && npm run dev
cd media-service && npm run dev
cd search-service && npm run dev
```

## API Endpoints

**Auth**: `/v1/auth/register`, `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`  
**Posts**: `/v1/posts/create-post`, `/v1/posts/all-posts`, `/v1/posts/:id`  
**Media**: `/v1/media/upload`, `/v1/media/:id`  
**Search**: `/v1/search?query=`

## Rate Limits

- Global: 100 req/15min
- Create Post: 20 req/min
- Delete Post: 20 req/10min
- Search: 30 req/min

## Roadmap

- [ ] Docker + docker-compose
- [ ] GitHub Actions CI/CD
- [ ] AWS EC2 deployment
- [ ] React/Next.js frontend

## Documentation

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design, data flow, and implementation patterns.

## License

MIT - See [LICENSE](LICENSE)

---

⭐ **Star this repo if you find it useful!**
