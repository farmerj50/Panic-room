const jwt = require("jsonwebtoken");

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireUserId(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Authentication required" });
  }
  return next();
}

module.exports = { authenticate, requireUserId };
