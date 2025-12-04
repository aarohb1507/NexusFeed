//write the imports
const express = require('express')
const helmet = require('helmet')
const mongoose = require('mongoose')
const logger = require('./utils/logger')
const cors = require('cors')
require('dotenv').config()
const Redis = require('ioredis')
const rateLimit = require('express-rate-limit')
const RedisStoreModule = require('rate-limit-redis')
const RedisStore = RedisStoreModule.default || RedisStoreModule
const errorHandler = require('./middleware/errorHandler')
const postRoutes = require('./routes/post-routes')

//initialize express app
const app = express()
const PORT = process.env.PORT || 3002

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI).then(()=>{
    logger.info('Connected to MongoDB')
})
.catch((err)=>{
    logger.error('Failed to connect to MongoDB: %s', err.message)
})

// Redis client
const redisClient = new Redis(process.env.REDIS_URL)

// Middleware setup
app.use(helmet())
app.use(express.json())
app.use(cors())

app.use((req, res, next)=>{
    logger.info(`Received ${req.method} request for ${req.url}`)
    logger.debug(`Request body: %o`, req.body)
    next()
})

// Global rate limiter (all endpoints)
const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded global rate limit', req.ip)
        res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.'
        })
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
})

// Stricter rate limiter for createPost (prevent spam posts)
const createPostLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // max 5 posts per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded createPost rate limit', req.ip)
        res.status(429).json({
            success: false,
            message: 'Too many posts created. Wait before posting again.'
        })
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
})

// Moderate rate limiter for deletePost (prevent deletion spam)
const deletePostLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 20, // max 20 deletes per 10 min
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded deletePost rate limit', req.ip)
        res.status(429).json({
            success: false,
            message: 'Too many deletions. Wait before deleting again.'
        })
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
})

// Apply global limiter to all routes
app.use(globalRateLimiter)

// Apply specific limiters to post routes


// Routes
app.use('/api/posts',(req, res, next) => {
    if (req.method === 'POST') {
        createPostLimiter(req, res, next)
    } else if (req.method === 'DELETE') {
        deletePostLimiter(req, res, next)
    }
    next();
}, postRoutes)

// Error handler
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
    logger.info(`Post Service running on port ${PORT}`)
    logger.info(`MongoDB: ${process.env.MONGODB_URI || 'unset'}`)
    logger.info(`Redis: ${process.env.REDIS_URL || 'unset'}`)
})


