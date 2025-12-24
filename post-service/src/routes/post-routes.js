const express = require('express');
const router = express.Router();
const {createPost, getAllPosts, getPost, deletePost} = require('../controller/post-controller');
const {authenticateUser} = require('../middleware/authMiddleware');
const {createPostLimiter, deletePostLimiter} = require('../middleware/rateLimiters');

// Rate limiter BEFORE auth
router.post('/create-post', createPostLimiter, authenticateUser, createPost)
router.get('/all-posts', getAllPosts, authenticateUser)
router.get('/:id', getPost, authenticateUser)
router.delete('/:id', deletePostLimiter, authenticateUser, deletePost)

module.exports = router;