const express = require('express')
const helmet = require('helmet')
const mongoose = require('mongoose')
const logger = require('./utils/Logger')
const cors = require('cors')
require('dotenv').config()

const app = express()
//connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).then(()=>{
    logger.info('Connected to MongoDB')
})
.catch((err)=>{
    logger.error('Failed to connect to MongoDB: %s', err.message)
})
// Middleware
app.use(helmet())
app.use(express.json())
app.use(cors())

app.use((req, res, next)=>{
    logger.info(`Recieved ${req.method} request for ${req.url}`)
    logger.info(`request body is ${req.body}`)
    next()
})