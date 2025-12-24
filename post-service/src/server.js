const express = require('express')
const helmet = require('helmet')
const mongoose = require('mongoose')
const logger = require('./utils/logger')
const cors = require('cors')
require('dotenv').config()
const errorHandler = require('./middleware/errorHandler')
const postRoutes = require('./routes/post-routes')
const {globalRateLimiter} = require('./middleware/rateLimiters')
const Redis = require('ioredis')
const { connectToRabbitMQ } = require('./utils/rabbitmq')

// Initialize express app
const app = express()
const PORT = process.env.PORT || 3002

// Redis client
const redisClient = new Redis(process.env.REDIS_URL)

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI).then(()=>{
    logger.info('Connected to MongoDB')
})
.catch((err)=>{
    logger.error('Failed to connect to MongoDB: %s', err.message)
})

// Middleware setup
app.use(helmet())
app.use(express.json())
app.use(cors())

app.use((req, res, next)=>{
    logger.info(`Received ${req.method} request for ${req.url}`)
    logger.debug(`Request body: %o`, req.body)
    next()
})

// Apply global rate limiter to all routes
app.use(globalRateLimiter)

// Apply post routes
app.use('/api/posts', postRoutes)

//redis client
app.use('/api/posts',(req, res, next)=>{
    req.redisClient = redisClient
    next()
})

// Error handler
app.use(errorHandler)

async function startServer() {
  try {
    await connectToRabbitMQ();
    app.listen(PORT, () => {
      logger.info(`Post service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to connect to server", error);
    process.exit(1);
  }
}
startServer();

// Start server
app.listen(PORT, () => {
    logger.info(`Post Service running on port ${PORT}`)
    logger.info(`MongoDB: ${process.env.MONGODB_URI || 'unset'}`)
    logger.info(`Redis: ${process.env.REDIS_URL || 'unset'}`)
})

// Unhandled promise rejection
process.on('unhandledRejection', (reason, promise)=>{
    logger.error('Unhandled Rejection at: %s, reason: %s', promise, reason)
})