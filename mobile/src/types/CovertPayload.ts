import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';

export const COVERT_PROTOCOL_VERSION = 1;

export type CovertPayloadFields = {
  senderPublicKey: Uint8Array; // 32 bytes
  nonce: Uint8Array; // 24 bytes (nacl.box.nonceLength)
  ciphertext: Uint8Array; // variable length, includes nacl.box's appended MAC
  messageId: string; // UUID string, encoded as 16 raw bytes on the wire
  timestamp: number; // ms since epoch
  location?: { latitude: number; longitude: number };
};

const PUBLIC_KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MESSAGE_ID_BYTES = 16;
const TIMESTAMP_BYTES = 8;
// version(1) + senderPublicKey(32) + nonce(24) + messageId(16) + timestamp(8) + hasLocation(1)
const HEADER_FIXED_LENGTH =
  1 + PUBLIC_KEY_BYTES + NONCE_BYTES + MESSAGE_ID_BYTES + TIMESTAMP_BYTES + 1;
const LOCATION_BYTES = 8; // latitude(4) + longitude(4), both float32BE

export function generateMessageId(): string {
  return Crypto.randomUUID();
}

export function encodeCovertPayload(fields: CovertPayloadFields): Buffer {
  if (fields.senderPublicKey.length !== PUBLIC_KEY_BYTES) {
    throw new Error(`senderPublicKey must be ${PUBLIC_KEY_BYTES} bytes`);
  }
  if (fields.nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce must be ${NONCE_BYTES} bytes`);
  }

  const messageIdBytes = Buffer.from(fields.messageId.replace(/-/g, ''), 'hex');
  if (messageIdBytes.length !== MESSAGE_ID_BYTES) {
    throw new Error('messageId must be a UUID that encodes to 16 bytes');
  }

  const hasLocation = fields.location != null;
  const header = Buffer.alloc(HEADER_FIXED_LENGTH + (hasLocation ? LOCATION_BYTES : 0));

  let offset = 0;
  header.writeUInt8(COVERT_PROTOCOL_VERSION, offset);
  offset += 1;
  Buffer.from(fields.senderPublicKey).copy(header, offset);
  offset += PUBLIC_KEY_BYTES;
  Buffer.from(fields.nonce).copy(header, offset);
  offset += NONCE_BYTES;
  messageIdBytes.copy(header, offset);
  offset += MESSAGE_ID_BYTES;
  header.writeBigUInt64BE(BigInt(Math.floor(fields.timestamp)), offset);
  offset += TIMESTAMP_BYTES;
  header.writeUInt8(hasLocation ? 1 : 0, offset);
  offset += 1;
  if (hasLocation && fields.location) {
    header.writeFloatBE(fields.location.latitude, offset);
    offset += 4;
    header.writeFloatBE(fields.location.longitude, offset);
    offset += 4;
  }

  return Buffer.concat([header, Buffer.from(fields.ciphertext)]);
}

export function decodeCovertPayload(buffer: Buffer): CovertPayloadFields {
  if (buffer.length < HEADER_FIXED_LENGTH) {
    throw new Error('Buffer too short to be a valid covert payload.');
  }

  let offset = 0;
  const version = buffer.readUInt8(offset);
  offset += 1;
  if (version !== COVERT_PROTOCOL_VERSION) {
    throw new Error(`Unsupported covert payload protocol version: ${version}`);
  }

  const senderPublicKey = new Uint8Array(buffer.subarray(offset, offset + PUBLIC_KEY_BYTES));
  offset += PUBLIC_KEY_BYTES;
  const nonce = new Uint8Array(buffer.subarray(offset, offset + NONCE_BYTES));
  offset += NONCE_BYTES;
  const messageId = buffer.subarray(offset, offset + MESSAGE_ID_BYTES).toString('hex');
  offset += MESSAGE_ID_BYTES;
  const timestamp = Number(buffer.readBigUInt64BE(offset));
  offset += TIMESTAMP_BYTES;
  const hasLocation = buffer.readUInt8(offset) === 1;
  offset += 1;

  let location: { latitude: number; longitude: number } | undefined;
  if (hasLocation) {
    if (buffer.length < offset + LOCATION_BYTES) {
      throw new Error('Buffer too short for the location fields it claims to have.');
    }
    const latitude = buffer.readFloatBE(offset);
    offset += 4;
    const longitude = buffer.readFloatBE(offset);
    offset += 4;
    location = { latitude, longitude };
  }

  const ciphertext = new Uint8Array(buffer.subarray(offset));

  return {
    senderPublicKey,
    nonce,
    ciphertext,
    messageId: [
      messageId.slice(0, 8),
      messageId.slice(8, 12),
      messageId.slice(12, 16),
      messageId.slice(16, 20),
      messageId.slice(20, 32),
    ].join('-'),
    timestamp,
    location,
  };
}
