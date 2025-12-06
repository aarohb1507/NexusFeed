const express = require('express')
const cors = require('cors')
require('dotenv').config()
const Redis = require('ioredis')
const logger = require('./utils/logger')
const helmet = require('helmet')
const { rateLimit } = require('express-rate-limit')
const { RedisStore } = require('rate-limit-redis')
const proxy = require('express-http-proxy')
const errorHandler = require('./middleware/errorHandler')

const app = express()
const PORT = process.env.PORT || 3000
const redisClient = new Redis(process.env.REDIS_URL)

// Middleware
app.use(helmet())
app.use(cors())
app.use(express.json())


// Request loggers
app.use((req, res, next) => {
    logger.info(`Received ${req.method} request for ${req.url}`)
    logger.debug('Request body: %o', req.body)
    next()
})

// Rate limiter (mounted early so it protects routes)
const rateLimiterMiddleware = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded rate limit on sensitive endpoint', req.ip)
        res.status(429).json({
            success: false,
            message: 'Too Many Requests on sensitive endpoint'
        })
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
})
app.use(rateLimiterMiddleware)

// Proxy options
const proxyOptions = {
    proxyReqPathResolver: (req) => req.originalUrl.replace(/^\/v1/, '/api'),
    proxyErrorHandler: (err, res) => {
        logger.error('Error while proxying request: %o', err)
        res.status(500).json({
            success: false,
            message: 'An error occurred while processing your request',
            error: err?.message || String(err)
        })
    },
}

// Mount /v1/auth proxy only if identity service URL is set
if (!process.env.IDENTITY_SERVICE_URL) {
    logger.warn('IDENTITY_SERVICE_URL not set — skipping /v1/auth proxy mount')
} else {
    app.use('/v1/auth', proxy(process.env.IDENTITY_SERVICE_URL, {
        ...proxyOptions,
        proxyReqOptDecorator: (proxyReqOpts) => {
            proxyReqOpts.headers['content-type'] = 'application/json'
            return proxyReqOpts
        },
        userResDecorator: (proxyRes, proxyResData, userReq) => {
            logger.info('Identity-service responded %d for %s', proxyRes.statusCode, userReq.originalUrl)
            return proxyResData
        }
    }))
}

// Mount /v1/posts proxy only if post service URL is set
if (!process.env.POST_SERVICE_URL) {
    logger.warn('POST_SERVICE_URL not set — skipping /v1/posts proxy mount')
} else {
    app.use('/v1/posts', proxy(process.env.POST_SERVICE_URL, {
        ...proxyOptions,
        proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
            proxyReqOpts.headers['content-type'] = 'application/json'
            proxyReqOpts.headers['x-user-id'] = srcReq.user.userId || ''
            return proxyReqOpts 
        },
        userResDecorator: (proxyRes, proxyResData, userReq) => {
            logger.info('Post-service responded %d for %s', proxyRes.statusCode, userReq.originalUrl)
            return proxyResData
        }})
    )
}

// Global error handler
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
    logger.info(`API Gateway is running on port ${PORT}`)
    logger.info(`Identity service is running on ${process.env.IDENTITY_SERVICE_URL || 'unset'}`)
    logger.info(`Post service is running on ${process.env.POST_SERVICE_URL || 'unset'}`)
    logger.info(`Redis is running on ${process.env.REDIS_URL || 'unset'}`)
})