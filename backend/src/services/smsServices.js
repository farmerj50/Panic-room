const TWILIO_TIMEOUT_MS = Number(process.env.TWILIO_TIMEOUT_MS) || 8000;
const RETRYABLE_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

class TwilioProviderError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "TwilioProviderError";
    this.status = status;
    // Only retry on network/timeout failures (no status) or server-side (5xx)
    // errors. A 4xx (e.g. invalid phone number) will never succeed on retry.
    this.retryable = status === undefined || status >= 500;
  }
}

async function withRetry(fn, { retries = RETRYABLE_RETRIES, baseDelayMs = RETRY_BASE_DELAY_MS } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error?.retryable ?? true;
      if (!retryable || attempt >= retries) throw error;

      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

const hasSmsProviderConfig = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );

const hasVoiceProviderConfig = hasSmsProviderConfig;

const escapeTwiml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

async function sendSmsOnce({ to, body }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: from,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new TwilioProviderError(`SMS provider failed: ${details}`, { status: response.status });
  }

  return response.json();
}

async function sendVoiceCallOnce({ to, message }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const twiml = `<Response><Say voice="alice">${escapeTwiml(message)}</Say></Response>`;
  const params = new URLSearchParams({
    To: to,
    From: from,
    Twiml: twiml,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new TwilioProviderError(`Voice provider failed: ${details}`, { status: response.status });
  }

  return response.json();
}

const sendSms = (args) => withRetry(() => sendSmsOnce(args));
const sendVoiceCall = (args) => withRetry(() => sendVoiceCallOnce(args));

module.exports = {
  TwilioProviderError,
  escapeTwiml,
  hasSmsProviderConfig,
  hasVoiceProviderConfig,
  sendSms,
  sendVoiceCall,
  withRetry,
};
