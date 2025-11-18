const express = require('express')
const helmet = require('helmet')
const mongoose = require('mongoose')
const logger = require('./utils/Logger')
const cors = require('cors')
require('dotenv').config()
const {RateLimiterRedis} = require('rate-limiter-flexible')
const Redis = require('ioredis')
const rateLimit = require('express-rate-limit')
const RedisStoreModule = require('rate-limit-redis')
const RedisStore = RedisStoreModule.default || RedisStoreModule
const Router = require('./routes/identity-service')
const errorHandler = require('./middleware/errorHandler')

const app = express()
const PORT = process.env.PORT || 3001
//connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).then(()=>{
    logger.info('Connected to MongoDB')
})
.catch((err)=>{
    logger.error('Failed to connect to MongoDB: %s', err.message)
})

//redisClient
const redisClient = new Redis(process.env.REDIS_URL)
// Middleware
app.use(helmet())
app.use(express.json())
app.use(cors())

app.use((req, res, next)=>{
    logger.info(`Recieved ${req.method} request for ${req.url}`)
    logger.info(`request body is ${req.body}`)
    next()
})

//DDOS Protection using rate limiting
const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'middleware',
    points: 100, // Number of points
    duration: 15 * 60, // Per 15 minutes
})

app.use((req, res, next)=>{
    rateLimiter.consume(req.ip).then(()=>{
        next()
    }).catch(()=>{
        logger.warn('Rate limit exceeded for IP: %s', req.ip)
        res.status(429).json({
            success: false,
            message: 'Too Many Requests'
        })
    })
})

//Ip based rate limting for sensitive endpoints

const rateLimiterMiddleware = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // limit each IP to 20 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,   
    handler : (req, res)=>{
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

//use the rate limiter middleware on sensitive endpoints
app.use('/api/auth/register', rateLimiterMiddleware)

//routes
app.use('/api/auth', Router)

//Global error handler
app.use(errorHandler)

//Start the server
app.listen(PORT, ()=>{
    logger.info(`Identity Service running on port ${PORT}`)
})

//unhandled promise rejection
process.on('unhandledRejection', (reason, promise)=>{
    logger.error('Unhandled Rejection at: %s, reason: %s', promise, reason)
})