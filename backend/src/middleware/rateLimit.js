const buckets = new Map();

// keyGenerator lets token-bearing routes bucket by IP alone, so an attacker
// can't get a fresh allowance for every guessed token path.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyGenerator } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : `${req.ip}:${req.path}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > max) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    return next();
  };
}

module.exports = { rateLimit };
