const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { validateEnv } = require("./config/env");
const authRoutes = require("./routes/authRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const contactRoutes = require("./routes/contactRoutes");
const privateDataRoutes = require("./routes/privateDataRoutes");
const recordingRoutes = require("./routes/recordingRoutes");
const userRoutes = require("./routes/userRoutes");
const covertMessageRoutes = require("./routes/covertMessageRoutes");
const billingRoutes = require("./routes/billingRoutes");
const accountLinkRoutes = require("./routes/accountLinkRoutes");
const socialSharingRoutes = require("./routes/socialSharingRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const legalRoutes = require("./routes/legalRoutes");
const { consentRouter, programRouter } = require("./routes/consentRoutes");
const twilioWebhookRoutes = require("./routes/twilioWebhookRoutes");
const errorMiddleware = require("./middleware/errorMiddleware");

validateEnv();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8081,http://localhost:19006")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
// Server-rendered public pages and Twilio webhooks are mounted BEFORE the
// CORS check. CORS guards the JSON API used by the web app; these are
// same-site HTML pages/forms (a browser sends an Origin header on a form
// POST, which CORS would reject) and server-to-server callbacks. A consent
// form POST is only meaningful with the secret invite token in its URL.
app.use("/legal", legalRoutes);
app.use("/sms-consent", consentRouter);
app.use("/sms-alerts", programRouter);
app.use("/api/twilio", twilioWebhookRoutes);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Bes backend is running");
});

app.use("/api/auth", authRoutes);
app.use("/api/emergency", emergencyRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/private-data", privateDataRoutes);
app.use("/api/recordings", recordingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/covert-messages", covertMessageRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/account-links", accountLinkRoutes);
app.use("/api/social", socialSharingRoutes);
app.use("/api/analytics", analyticsRoutes);

app.use(errorMiddleware);

module.exports = app;
