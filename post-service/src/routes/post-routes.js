const express = require('express');
const router = express.Router();
const {createPost, getAllPosts, getPost, deletePost} = require('../controller/post-controller');
const logger = require('../utils/logger');
const {authenticateUser} = require('../middleware/authMiddleware');

router.post('/create-post', authenticateUser, createPost)

module.exports = router;