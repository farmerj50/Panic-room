import * as Crypto from 'expo-crypto';

import { deleteItemAsync, getItemAsync, setItemAsync } from './secureStorage';

const PIN_HASH_KEY = 'bes_pin_hash';
const PIN_SALT_KEY = 'bes_pin_salt';

function randomSaltHex(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${pin}:${salt}`);
}

export async function isPinSet(): Promise<boolean> {
  return (await getItemAsync(PIN_HASH_KEY)) !== null;
}

export async function setPin(pin: string): Promise<void> {
  const salt = randomSaltHex();
  const hash = await hashPin(pin, salt);
  await setItemAsync(PIN_SALT_KEY, salt);
  await setItemAsync(PIN_HASH_KEY, hash);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [salt, storedHash] = await Promise.all([getItemAsync(PIN_SALT_KEY), getItemAsync(PIN_HASH_KEY)]);
  if (!salt || !storedHash) return false;
  const hash = await hashPin(pin, salt);
  return hash === storedHash;
}

export async function clearPin(): Promise<void> {
  await Promise.all([deleteItemAsync(PIN_HASH_KEY), deleteItemAsync(PIN_SALT_KEY)]);
}
