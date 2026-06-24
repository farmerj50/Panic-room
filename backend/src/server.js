const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { validateEnv } = require("./config/env");
const authRoutes = require("./routes/authRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const contactRoutes = require("./routes/contactRoutes");
const privateDataRoutes = require("./routes/privateDataRoutes");
const recordingRoutes = require("./routes/recordingRoutes");
const errorMiddleware = require("./middleware/errorMiddleware");

validateEnv();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8081,http://localhost:19006")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const publicDir = path.join(__dirname, "..", "public");

app.disable("x-powered-by");
app.use("/api", (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/api",
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/private-data", privateDataRoutes);
app.use("/api/recordings", recordingRoutes);

// Web build of the mobile app — served from the same origin so its API
// calls can be relative (see mobile/src/config/emergencyConfig.ts).
app.use(express.static(publicDir));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`PanicRoom backend running on port ${PORT}`);
});
