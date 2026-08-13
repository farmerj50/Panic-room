const express = require("express");
const router = express.Router();

const { deleteMe, setPublicKey, updateMe } = require("../controllers/userController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

router.use(authenticate, requireUserId);
router.patch("/me", updateMe);
router.put("/me/public-key", setPublicKey);
router.delete("/me", deleteMe);

module.exports = router;
