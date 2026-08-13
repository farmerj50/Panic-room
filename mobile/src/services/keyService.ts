import './naclSetup';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

import { getItemAsync, setItemAsync } from './secureStorage';

const SECRET_KEY_STORAGE_KEY = 'bes_covert_secret_key';

let cachedKeyPair: nacl.BoxKeyPair | null = null;

// The private key never leaves the device (SecureStore, or localStorage on
// web — see secureStorage.ts) and is never sent to the backend — only the
// public key is uploaded (via covertMessageService).
export async function getOrCreateKeyPair(): Promise<nacl.BoxKeyPair> {
  if (cachedKeyPair) return cachedKeyPair;

  const storedSecretKey = await getItemAsync(SECRET_KEY_STORAGE_KEY);
  if (storedSecretKey) {
    cachedKeyPair = nacl.box.keyPair.fromSecretKey(decodeBase64(storedSecretKey));
    return cachedKeyPair;
  }

  const keyPair = nacl.box.keyPair();
  await setItemAsync(SECRET_KEY_STORAGE_KEY, encodeBase64(keyPair.secretKey));
  cachedKeyPair = keyPair;
  return keyPair;
}

export async function getPublicKeyBase64(): Promise<string> {
  const keyPair = await getOrCreateKeyPair();
  return encodeBase64(keyPair.publicKey);
}

// Only for tests / explicit "regenerate my key" flows — normal app code
// should never need to drop the cached pair mid-session.
export function clearCachedKeyPair() {
  cachedKeyPair = null;
}
