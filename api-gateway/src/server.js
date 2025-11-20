const express = require('express')
const cors = require('cors')
require('dotenv').config()
const logger = require('./utils/logger')
const helmet = require('helmet')
const {rateLimit} = require('express-rate-limit') 
const {RedisStore} = require('rate-limit-redis')
const httpProxy = require('express-http-proxy')

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(helmet())
app.use(cors())
app.use(express.json())

//logger middleware
app.use((req, res, next)=>{
    logger.info(`Received ${req.method} request for ${req.url}`)
    logger.debug(`Request body: %o`, req.body)
    next()
})
// Rate Limiting

const rateLimiterMiddleware = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 20 requests per windowMs
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