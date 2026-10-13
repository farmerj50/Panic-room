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

// Transactional (non-template) mail only needs the API key.
function hasTransactionalEmailConfig() {
  return Boolean(process.env.RESEND_API_KEY);
}

// One-time code a Google-only account must enter before it can be deleted.
async function sendAccountDeletionCode({ to, code }) {
  if (!hasTransactionalEmailConfig()) throw new Error("Resend is not configured");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    subject: "Your Bes account deletion code",
    text:
      `Your Bes account deletion code is ${code}. It expires in 10 minutes.\n\n` +
      "If you didn't ask to delete your Bes account, ignore this email — nothing will be deleted. " +
      "Consider securing your Google account.",
  });
  if (error) throw new Error(error.message || "Failed to send deletion code");
  return data;
}

module.exports = { hasResendConfig, hasTransactionalEmailConfig, sendAccountDeletionCode, sendWelcomeEmail };
