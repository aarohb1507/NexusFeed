const logger = require('../utils/logger');
const Post = require('../models/Post');
const {validatePost} = require('../utils/validation');


const invalidatePost = async (req, input) => {
    const cachedKey = `post:${input}`;
  await req.redisClient.del(cachedKey);

  const keys = await req.redisClient.keys("posts:*");
  if (keys.length > 0) {
    await req.redisClient.del(keys);
  }   
}
// Create a new post
const createPost = async (req, res, next) => {
    logger.info("Hit createPost endpoint");
    try {
        const {error} = validatePost(req.body)
        if (error){
            logger.warn("Validation failed during post creation: %s", error.details[0].message)
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: error.details.map(err => ({
                    field: err.context.key,
                    message: err.message
                }))
            })
        }
        const {content, mediaIds} = req.body
        const post = new Post({
            user: req.user.id,
            content,
            mediaIds: mediaIds || []
        });
        await post.save();
        await invalidatePost(req, 'posts:*')
        logger.info("Post created with ID: %s", post._id)
        return res.status(201).json({
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;

    const cacheKey = `posts:${page}:${limit}`;
    const cachedPosts = await req.redisClient.get(cacheKey);

    if (cachedPosts) {
      return res.json(JSON.parse(cachedPosts));
    }

    const posts = await Post.find({})
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);

    const totalNoOfPosts = await Post.countDocuments();

    const result = {
      posts,
      currentpage: page,
      totalPages: Math.ceil(totalNoOfPosts / limit),
      totalPosts: totalNoOfPosts,
    };

    //save your posts in redis cache
    await req.redisClient.setex(cacheKey, 300, JSON.stringify(result));

    res.json(result);
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
        const postId = req.params.id;
    const cachekey = `post:${postId}`;
    const cachedPost = await req.redisClient.get(cachekey);

    if (cachedPost) {
      return res.json(JSON.parse(cachedPost));
    }

    const singlePostDetailsbyId = await Post.findById(postId);

    if (!singlePostDetailsbyId) {
      return res.status(404).json({
        message: "Post not found",
        success: false,
      });
    }

    await req.redisClient.setex(
      cachedPost,
      3600,
      JSON.stringify(singlePostDetailsbyId)
    );

    res.json(singlePostDetailsbyId);
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
        const post = await Post.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!post) {
      return res.status(404).json({
        message: "Post not found",
        success: false,
      });
    }
    
    await invalidatePost(req, req.params.id);
    return res.status(200).json({
        success: true,
        message: "Post deleted successfully"
    });
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