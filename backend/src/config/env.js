const REQUIRED_KEYS = ["DATABASE_URL", "JWT_SECRET", "DATA_ENCRYPTION_KEY"];

function validateEnv() {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters.");
  }
}

module.exports = { validateEnv };
