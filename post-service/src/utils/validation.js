const Joi = require('joi')

const validatePost = (data)=>{
    const schema =Joi.object({
        content: Joi.string().min(1).max(500).required(),
    })
    return schema.validate(data)
}


module.exports = {
    validatePost
}

