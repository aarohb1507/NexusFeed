const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const RefreshToken = require('../models/RefreshTokens')

const generateTokens = async (user)=>{
    const accessToken = jwt.sign({
        id: user._id,
        username: user.username,
    }, process.env.JWT_SECRET, {expiresIn: '15m'})

    const refreshToken = crypto.randomBytes(40).toString('hex')
    const expiresAt = new Date(Date.now() + 7*24*60*60*1000) //7 days

    await RefreshToken.create({
        token: refreshToken,
        user: user._id,
        expiresAt
    })

    return { accessToken, refreshToken }
}

module.exports = {
    generateTokens
}