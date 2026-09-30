const { Resend } = require("resend");

// Bes's published Resend welcome-email template (set up in the Resend
// dashboard, not recreated here) is currently static — no merge variables
// defined on it yet. Don't pass a `variables` object until the template
// actually defines matching merge tags in Resend; sending one that doesn't
// match a defined variable is harmless but pointless.
const FROM = "Bes <support@bes-app.com>";
const REPLY_TO = "support@bes-app.com";

function hasResendConfig() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_WELCOME_TEMPLATE_ID);
}

async function sendWelcomeEmail({ to }) {
  if (!hasResendConfig()) {
    throw new Error("Resend is not configured");
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    template: { id: process.env.RESEND_WELCOME_TEMPLATE_ID },
  });

  if (error) {
    throw new Error(error.message || "Failed to send welcome email");
  }

  return data;
}

module.exports = { hasResendConfig, sendWelcomeEmail };
