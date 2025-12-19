const express = require("express");
const multer = require("multer");
const {
  uploadMedia,
  getAllMedias,
} = require("../controller/media-controller");
const { authenticateUser } = require("../middleware/authMiddleware");
const logger = require("../utils/logger");
const { uploadMediaLimiter, getMediaLimiter } = require("../middleware/rateLimiters");
const router = express.Router();

//configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).single("file");

router.post(
  "/upload",
  uploadMediaLimiter,
  authenticateUser,
  (req, res, next) => {
    upload(req, res, function (err) {
      if (err instanceof multer.MulterError) {
        logger.error("Multer error while uploading:", err);
        return res.status(400).json({
          message: "Multer error while uploading:",
          error: err.message,
          stack: err.stack,
        });
      } else if (err) {
        logger.error("Unknown error occured while uploading:", err);
        return res.status(500).json({
          message: "Unknown error occured while uploading:",
          error: err.message,
          stack: err.stack,
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "No file found!",
        });
      }

      next();
    });
  },
  uploadMedia
);

router.get("/get",getMediaLimiter, authenticateUser, getAllMedias);

module.exports = router;