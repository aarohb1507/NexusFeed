const logger = require('../utils/Logger')

const errorHandler = (err, req, res, next) => {
    logger.error(err.stack)

    res.status(err.status || 500).json({
        message: err.message || 'Internal Server Error'
    })
}

module.exports = errorHandler