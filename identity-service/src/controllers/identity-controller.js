const User = require('../models/User')
const logger = require('../utils/Logger')
const {validateRegistration} = require('../utils/validation')


//user-registeration

const registerUser = async (req, res, next) => {
    logger.info("Hit registerUser endpoint")
    try {
        const {error} = validateRegistration(req.body)
        if (error){
            logger.warn("Validation failed during user registration: %s", error.details[0].message)
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map(err => ({
                    field: err.context.key,
                    message: err.message
                }))
            })
        }
        const { username, email, password } = req.body
        let user = await User.findOne({ $or: [ { email }, { username } ] })
        if (user){
            logger.warn("Registration attempt with existing email or username: %s, %s", email, username)
            return res.status(409).json({
                success: false,
                message: "Email or Username already in use"
            })
        }
        user = new User({username, email, password})
        await user.save()
        res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        })
    } catch (error) {
         
    }

}

//user-login
//refresh-token
//logoutß