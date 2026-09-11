const prisma = require("../config/db");
const { isUserPremium } = require("../services/subscriptionService");

// Composes after authenticate/requireUserId, which already attach req.user.id.
async function requirePremium(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionExpiresAt: true },
    });
    if (!isUserPremium(user)) {
      return res.status(403).json({ error: "Bes Premium is required for this feature.", code: "PREMIUM_REQUIRED" });
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requirePremium };
