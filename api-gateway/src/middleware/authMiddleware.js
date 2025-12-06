const logger = require('../utils/logger')
const jwt = require('jsonwebtoken')
const validateToken = (req, res, next) => {
    
    const authHeader = req.headers['authorization']
    if (!authHeader) {
        logger.warn('No Authorization header present')
        return res.status(401).json({
            success: false,
            message: 'Authorization header missing'
        })
    }

    const token = authHeader.split(' ')[1]
    if (!token) {
        logger.warn('No token provided in Authorization header')
        return res.status(401).json({
            success: false,
            message: 'Token missing from Authorization header'
        })
    }

    // Here you would normally validate the token (e.g., JWT verification)
   jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            logger.warn('Invalid token: %s', err.message)
            return res.status(403).json({
                success: false,
                message: 'Invalid or expired token'
            })
        }
        req.user = user
        next()
    })
}

module.exports = {
    validateToken
}