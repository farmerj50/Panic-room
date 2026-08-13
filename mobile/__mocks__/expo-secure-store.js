// jest-expo's built-in auto-mock for expo-secure-store doesn't actually
// persist anything (getItemAsync always resolves null), which silently
// breaks any test that relies on "write then read back" — e.g. keyService's
// "the key pair survives a cache clear" contract. This manual mock — picked
// up automatically by Jest for any node_modules package of the same name —
// backs it with a real in-memory Map instead.
const store = new Map();

async function getItemAsync(key) {
  return store.has(key) ? store.get(key) : null;
}

function getItem(key) {
  return store.has(key) ? store.get(key) : null;
}

async function setItemAsync(key, value) {
  store.set(key, value);
}

function setItem(key, value) {
  store.set(key, value);
}

async function deleteItemAsync(key) {
  store.delete(key);
}

async function isAvailableAsync() {
  return true;
}

function canUseBiometricAuthentication() {
  return false;
}

module.exports = {
  getItemAsync,
  getItem,
  setItemAsync,
  setItem,
  deleteItemAsync,
  isAvailableAsync,
  canUseBiometricAuthentication,
};
