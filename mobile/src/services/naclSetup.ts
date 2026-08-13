import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

// tweetnacl has no secure RNG of its own — it looks for global crypto (Web
// Crypto API) or Node's require('crypto'), neither of which exists in
// Hermes/React Native by default, and throws "no PRNG" on first use
// (nacl.randomBytes, nacl.box.keyPair(), nacl.box()) without this. Wiring
// it to expo-crypto's synchronous, Web-Crypto-compatible getRandomValues
// is the Expo-idiomatic fix (avoids adding a separate native-module
// polyfill like react-native-get-random-values).
// Side-effect import only — every module that uses nacl must import this
// first; ES module caching makes repeated imports a no-op after the first.
nacl.setPRNG((buffer, length) => {
  Crypto.getRandomValues(buffer.subarray(0, length));
});
