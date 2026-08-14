import { clearPin, isPinSet, setPin, verifyPin } from '../pinStorage';
import { getItemAsync } from '../secureStorage';

describe('pinStorage', () => {
  afterEach(async () => {
    await clearPin();
  });

  test('isPinSet is false before any PIN is set', async () => {
    expect(await isPinSet()).toBe(false);
  });

  test('setPin then verifyPin with the correct PIN succeeds', async () => {
    await setPin('1234');
    expect(await isPinSet()).toBe(true);
    expect(await verifyPin('1234')).toBe(true);
  });

  test('verifyPin with the wrong PIN returns false, not a throw', async () => {
    await setPin('1234');
    await expect(verifyPin('9999')).resolves.toBe(false);
  });

  test('verifyPin returns false when no PIN has ever been set', async () => {
    expect(await verifyPin('1234')).toBe(false);
  });

  test('clearPin removes the stored PIN', async () => {
    await setPin('1234');
    await clearPin();
    expect(await isPinSet()).toBe(false);
    expect(await verifyPin('1234')).toBe(false);
  });

  test('two setPin calls with the same PIN produce different stored hashes (per-install salt)', async () => {
    await setPin('1234');
    const firstHash = await getItemAsync('bes_pin_hash');

    await setPin('1234');
    const secondHash = await getItemAsync('bes_pin_hash');

    expect(firstHash).not.toBeNull();
    expect(secondHash).not.toBeNull();
    expect(firstHash).not.toBe(secondHash);
  });
});
