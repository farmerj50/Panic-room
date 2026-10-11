// Masks secrets that can appear in URLs or headers before anything is
// logged: Live View media signatures and ids, SMS consent invite tokens,
// signed-download tokens, and bearer credentials.
const PATTERNS = [
  [/(\/live\/media\/)[^\s?"']+/g, "$1***"],
  [/(\/live\/)(?!media\/|api\/|assets\/)[^\s?"'#]+/g, "$1***"],
  [/(\/sms-consent\/)[^\s?"']+/g, "$1***"],
  [/([?&](?:sig|token|exp)=)[^&\s"']+/g, "$1***"],
  [/(Bearer\s+)[A-Za-z0-9._~+\/=-]+/gi, "$1***"],
  [/#[A-Za-z0-9_-]{30,}/g, "#***"],
];

function redact(value) {
  let text = typeof value === "string" ? value : value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ""}` : String(value);
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

module.exports = { redact };
