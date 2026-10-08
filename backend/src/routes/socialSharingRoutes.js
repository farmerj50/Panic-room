const express = require("express");
const router = express.Router();

const {
  listConnections,
  initiateConnect,
  handleCallback,
  disconnect,
  updatePreference,
  share,
  getPublishOptions,
} = require("../controllers/socialSharingController");
const { authenticate, requireUserId } = require("../middleware/authMiddleware");

// PUBLIC — the OAuth provider redirects the user's browser here directly,
// with no bearer token possible. Must be registered before the
// authenticate/requireUserId block below, which would otherwise 401 it.
// handleCallback authenticates the request itself via the signed `state`
// param (see oauthStateService).
router.get("/:provider/callback", handleCallback);

router.use(authenticate, requireUserId);

router.get("/", listConnections);
router.post("/:provider/connect", initiateConnect);
router.delete("/:provider", disconnect);
router.patch("/:provider", updatePreference);
router.get("/:provider/publish-options", getPublishOptions);
router.post("/:provider/share", share);

module.exports = router;
