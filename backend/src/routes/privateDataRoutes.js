const express = require("express");
const router = express.Router();

const {
  deletePrivateData,
  getPrivateData,
  upsertPrivateData,
} = require("../controllers/privateDataController");
const { authenticate } = require("../middleware/authMiddleware");

router.use(authenticate);
router.get("/:key", getPrivateData);
router.put("/:key", upsertPrivateData);
router.delete("/:key", deletePrivateData);

module.exports = router;
