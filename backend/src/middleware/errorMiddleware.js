function errorMiddleware(error, req, res, next) {
  console.error(error);

  res.status(500).json({
    message: "Server error",
    error: process.env.NODE_ENV === "production" ? "Unexpected server error" : error.message,
  });
}

module.exports = errorMiddleware;
