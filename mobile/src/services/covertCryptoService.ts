import './naclSetup';
import nacl from 'tweetnacl';

export type BoxResult = {
  ciphertext: Uint8Array; // includes the appended Poly1305 MAC (nacl.box's output)
  nonce: Uint8Array;
};

// nacl.box = X25519 (key agreement) + XSalsa20-Poly1305 (authenticated
// encryption). Chosen over XChaCha20-Poly1305/libsodium specifically
// because it's pure JS — no WASM/native module — which matters since
// mobile/ios/ hasn't been prebuilt yet. Equally sound in practice; see
// keyService.ts for the fuller rationale.
export function encryptMessage(
  message: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
): BoxResult {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(message, nonce, recipientPublicKey, senderSecretKey);
  return { ciphertext, nonce };
}

// Returns null on any failure (wrong key, tampered ciphertext, wrong nonce)
// rather than throwing — nacl.box.open already returns false/null on auth
// failure, so this just normalizes that into a single null-return contract.
export function decryptMessage(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array | null {
  const opened = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecretKey);
  return opened ?? null;
}
