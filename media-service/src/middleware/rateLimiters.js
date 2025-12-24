const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const RedisStoreModule = require('rate-limit-redis');
const RedisStore = RedisStoreModule.default || RedisStoreModule;
const logger = require('../utils/logger');

const redisClient = new Redis(process.env.REDIS_URL);

const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // More generous than post service
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded global rate limit', req.ip);
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.'
        });
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
});

const uploadMediaLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 50, // 10 uploads per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded uploadMedia rate limit', req.ip);
        return res.status(429).json({
            success: false,
            message: 'Too many media uploads. Please wait before uploading again.'
        });
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
});

const getMediaLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('IP %s exceeded getAllMedias rate limit', req.ip);
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please slow down.'
        });
    },
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    }),
});

module.exports = {
    globalRateLimiter,
    uploadMediaLimiter,
    getMediaLimiter
};