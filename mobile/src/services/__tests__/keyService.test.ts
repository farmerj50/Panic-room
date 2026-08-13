import { clearCachedKeyPair, getOrCreateKeyPair, getPublicKeyBase64 } from '../keyService';

describe('keyService', () => {
  afterEach(() => {
    clearCachedKeyPair();
  });

  test('generates a key pair and reuses the same one on subsequent calls (in-memory cache)', async () => {
    const first = await getOrCreateKeyPair();
    const second = await getOrCreateKeyPair();

    expect(Buffer.from(first.publicKey).equals(Buffer.from(second.publicKey))).toBe(true);
    expect(Buffer.from(first.secretKey).equals(Buffer.from(second.secretKey))).toBe(true);
  });

  test('persists the secret key to SecureStore so a fresh cache reloads the same key pair', async () => {
    const first = await getOrCreateKeyPair();
    clearCachedKeyPair();
    const second = await getOrCreateKeyPair();

    expect(Buffer.from(first.publicKey).equals(Buffer.from(second.publicKey))).toBe(true);
  });

  test('getPublicKeyBase64 matches the key pair\'s actual public key', async () => {
    const keyPair = await getOrCreateKeyPair();
    const publicKeyBase64 = await getPublicKeyBase64();

    expect(publicKeyBase64).toBe(Buffer.from(keyPair.publicKey).toString('base64'));
  });
});
