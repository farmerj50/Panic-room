const crypto = require("crypto");

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
    // Twilio's own error code from the JSON body (e.g. 21610 = recipient
    // replied STOP, 20003 = bad credentials), when present.
    this.twilioCode = parseTwilioCode(message);
  }
}

function parseTwilioCode(message) {
  const match = String(message || "").match(/\{.*\}/s);
  if (!match) return null;
  try {
    return JSON.parse(match[0]).code ?? null;
  } catch {
    return null;
  }
}

// Thrown when we can't know whether Twilio accepted the message (timeout /
// network error after the request left). Never retried — retrying could
// send a duplicate emergency alert. Reconciled later by the stale-send sweep.
class UncertainSendError extends Error {
  constructor(cause) {
    super(`SMS send outcome unknown: ${cause?.message || cause}`);
    this.name = "UncertainSendError";
    this.uncertain = true;
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

async function sendSmsOnce({ to, body, statusCallback }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: from,
    Body: body,
  });
  if (statusCallback) params.set("StatusCallback", statusCallback);

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

// Emergency alert sender: retries ONLY when Twilio explicitly answered that it
// did not take the request (429 Too Many Requests / 503 Unavailable). A
// timeout or dropped connection is ambiguous — Twilio may already have
// queued the text — so it surfaces as UncertainSendError and is NOT retried.
async function sendAlertSms(args, { retries = 2, baseDelayMs = RETRY_BASE_DELAY_MS } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendSmsOnce(args);
    } catch (error) {
      if (!(error instanceof TwilioProviderError)) throw new UncertainSendError(error);
      const definitelyNotAccepted = error.status === 429 || error.status === 503;
      if (!definitelyNotAccepted || attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
}

// Read-only: messages from our number to `to`, sent on/after `since`.
async function listSentMessages({ to, since }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: process.env.TWILIO_FROM_NUMBER,
    "DateSent>": since.toISOString().slice(0, 10),
    PageSize: "50",
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?${params}`,
    { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS) },
  );
  if (!response.ok) {
    throw new TwilioProviderError(`Message lookup failed: ${await response.text()}`, { status: response.status });
  }
  const json = await response.json();
  return json.messages || [];
}

// Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted
// key/value pairs of the POST body)). Requires the Auth Token.
function computeTwilioSignature(url, params, authToken = process.env.TWILIO_AUTH_TOKEN) {
  const data = Object.keys(params || {})
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", authToken || "").update(Buffer.from(data, "utf-8")).digest("base64");
}

function isValidTwilioSignature(url, params, signature) {
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  const expected = Buffer.from(computeTwilioSignature(url, params));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
const sendVoiceCall = (args) => withRetry(() => sendVoiceCallOnce(args));

module.exports = {
  TwilioProviderError,
  UncertainSendError,
  sendAlertSms,
  listSentMessages,
  computeTwilioSignature,
  isValidTwilioSignature,
  escapeTwiml,
  hasSmsProviderConfig,
  hasVoiceProviderConfig,
  sendSms,
  sendVoiceCall,
  withRetry,
};
