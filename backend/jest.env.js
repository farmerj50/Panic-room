const path = require("path");

// Loaded before any test file, so app modules (config/db.js, etc.) that read
// process.env at require-time always see the test database, not dev's.
require("dotenv").config({ path: path.join(__dirname, ".env.test"), override: true });
