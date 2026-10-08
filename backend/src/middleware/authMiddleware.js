const jwt = require("jsonwebtoken");

const prisma = require("../config/db");

// Verifies the access token AND that its account still exists. The JWT alone
// stays valid for its full lifetime (15m), so without the lookup a deleted
// account's token kept working until it expired.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  if (typeof payload?.sub !== "string" || !payload.sub) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
    if (!user) return res.status(401).json({ error: "Invalid or expired session" });
  } catch (error) {
    return next(error);
  }

  req.user = { id: payload.sub };
  return next();
}

function requireUserId(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Authentication required" });
  }
  return next();
}

module.exports = { authenticate, requireUserId };
