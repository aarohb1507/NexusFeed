const logger = require('../utils/logger');
const Post = require('../models/Post');
const {authenticateUser} = require('../middleware/authMiddleware');

// Create a new post
const createPost = async (req, res, next) => {
    logger.info("Hit createPost endpoint");
    try {
        const {content, mediaId} = req.body
        const post = new Post({
            user: req.user.userId,
            content,
            mediaId: mediaId || []
        });
        await post.save();
        logger.info("Post created with ID: %s", post._id);
        return  res.status(201).json({
            success: true,
            data: post
        })

    } catch (error) {
        logger.error("Error in createPost: %s", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
}
const getAllPosts = async (req, res, next) => {
    logger.info("Hit getPosts endpoint");
    try {
        
    } catch (error) {
        logger.error("Error in getPosts: %s", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
}
const getPost = async (req, res, next) => {
    logger.info("Hit getPost endpoint");
    try {
        
    } catch (error) {
        logger.error("Error in getPost: %s", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
}
const deletePost = async (req, res, next) => {
    logger.info("Hit deletePost endpoint");
    try {
        
    } catch (error) {
        logger.error("Error in deletePost: %s", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
}
module.exports = {
    createPost,
    getAllPosts,
    getPost,
    deletePost
}