// jest-expo's built-in auto-mock for expo-crypto returns all-zero bytes from
// getRandomValues, which silently makes any crypto test meaningless (a zero
// PRNG makes every "random" key pair identical). This manual mock — picked
// up automatically by Jest for any node_modules package of the same name —
// backs getRandomValues with Node's real crypto.randomBytes so tests
// actually exercise correct, non-deterministic behavior.
const nodeCrypto = require('crypto');

function getRandomValues(typedArray) {
  const bytes = nodeCrypto.randomBytes(typedArray.length);
  typedArray.set(bytes);
  return typedArray;
}

function getRandomBytes(byteCount) {
  return new Uint8Array(nodeCrypto.randomBytes(byteCount));
}

async function getRandomBytesAsync(byteCount) {
  return getRandomBytes(byteCount);
}

function randomUUID() {
  return nodeCrypto.randomUUID();
}

const CryptoDigestAlgorithm = { SHA256: 'SHA-256' };

async function digestStringAsync(_algorithm, data) {
  return nodeCrypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

module.exports = {
  getRandomValues,
  getRandomBytes,
  getRandomBytesAsync,
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm,
};
