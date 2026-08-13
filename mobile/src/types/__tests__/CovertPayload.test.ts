import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

import { decodeCovertPayload, encodeCovertPayload, generateMessageId } from '../CovertPayload';

function randomFields(overrides: Partial<Parameters<typeof encodeCovertPayload>[0]> = {}) {
  const keyPair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.randomBytes(64);

  return {
    senderPublicKey: keyPair.publicKey,
    nonce,
    ciphertext,
    messageId: generateMessageId(),
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('CovertPayload', () => {
  test('round-trips all fields without GPS', () => {
    const fields = randomFields();
    const decoded = decodeCovertPayload(encodeCovertPayload(fields));

    expect(Buffer.from(decoded.senderPublicKey).equals(Buffer.from(fields.senderPublicKey))).toBe(true);
    expect(Buffer.from(decoded.nonce).equals(Buffer.from(fields.nonce))).toBe(true);
    expect(Buffer.from(decoded.ciphertext).equals(Buffer.from(fields.ciphertext))).toBe(true);
    expect(decoded.messageId).toBe(fields.messageId);
    expect(decoded.timestamp).toBe(fields.timestamp);
    expect(decoded.location).toBeUndefined();
  });

  test('round-trips with GPS coordinates present', () => {
    const fields = randomFields({ location: { latitude: 40.7128, longitude: -74.006 } });
    const decoded = decodeCovertPayload(encodeCovertPayload(fields));

    expect(decoded.location).toBeDefined();
    // float32 precision — GPS coordinates need ~6 decimal places (~0.1m),
    // float32 comfortably gives more than that; allow a tiny epsilon.
    expect(decoded.location!.latitude).toBeCloseTo(40.7128, 4);
    expect(decoded.location!.longitude).toBeCloseTo(-74.006, 4);
  });

  test('rejects a payload with an unsupported protocol version', () => {
    const encoded = encodeCovertPayload(randomFields());
    const tampered = Buffer.from(encoded);
    tampered.writeUInt8(99, 0); // corrupt the version byte

    expect(() => decodeCovertPayload(tampered)).toThrow(/protocol version/i);
  });

  test('rejects a senderPublicKey of the wrong length', () => {
    expect(() => encodeCovertPayload(randomFields({ senderPublicKey: new Uint8Array(16) }))).toThrow(
      /32 bytes/,
    );
  });

  test('rejects a nonce of the wrong length', () => {
    expect(() => encodeCovertPayload(randomFields({ nonce: new Uint8Array(12) }))).toThrow(/24 bytes/);
  });

  test('generateMessageId produces distinct UUIDs', () => {
    const a = generateMessageId();
    const b = generateMessageId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
