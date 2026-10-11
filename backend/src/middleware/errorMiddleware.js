const { redact } = require("../utils/redact");

function errorMiddleware(error, req, res, next) {
  // Never log a raw URL or credential: Live View and consent links carry
  // secrets in their paths and query strings.
  console.error(`${req.method} ${redact(req.originalUrl || "")}:`, redact(error));

  res.status(500).json({
    message: "Server error",
    error: process.env.NODE_ENV === "production" ? "Unexpected server error" : error.message,
  });
}

module.exports = errorMiddleware;
