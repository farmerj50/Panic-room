import { Buffer } from 'buffer';
import UPNG from 'upng-js';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// pngjs was the original choice but depends on Node's util/stream/zlib
// modules, none of which Metro polyfills for React Native or web bundles
// ("util.inherits is not a function" at runtime) — discovered only once the
// app actually ran, since Jest's Node test environment masked it. upng-js
// is pure JS with a single dependency (pako, itself pure JS, no Node
// builtins), so it bundles cleanly on both targets.
const LENGTH_PREFIX_BYTES = 4;
const CHANNELS_PER_PIXEL = 3; // R, G, B — alpha is left untouched

function bytesToBits(bytes: Buffer): number[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

function bitsToBytes(bits: number[]): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

// Buffer's .buffer is its underlying ArrayBuffer, which may be larger than
// the Buffer itself (shared/pooled) — slice to the exact byte range so this
// is a real, standalone ArrayBuffer regardless of that.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function decodeToRgba(pngBuffer: Buffer): { rgba: Uint8Array; width: number; height: number } {
  const decoded = UPNG.decode(toArrayBuffer(pngBuffer));
  // toRGBA8 returns one ArrayBuffer per frame; a still PNG has exactly one.
  // Wrapping an ArrayBuffer in Uint8Array creates a zero-copy view, so
  // mutating `rgba` in place mutates this buffer directly.
  const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
  return { rgba, width: decoded.width, height: decoded.height };
}

// Pure buffer-in/buffer-out logic — deliberately has no expo-file-system
// dependency so it's unit-testable in plain Jest without a device.
export function embedPayload(pngBuffer: Buffer, payload: Buffer): Buffer {
  let rgba: Uint8Array, width: number, height: number;
  try {
    ({ rgba, width, height } = decodeToRgba(pngBuffer));
  } catch {
    throw new Error('Could not read this as a PNG image. Try a different image.');
  }
  const capacityBits = width * height * CHANNELS_PER_PIXEL;

  const lengthBytes = Buffer.alloc(LENGTH_PREFIX_BYTES);
  lengthBytes.writeUInt32BE(payload.length, 0);
  const fullBits = bytesToBits(Buffer.concat([lengthBytes, payload]));

  if (fullBits.length > capacityBits) {
    throw new Error(
      `Payload too large for this image: needs ${fullBits.length} bits, image has ${capacityBits} bits of capacity.`,
    );
  }

  let bitIndex = 0;
  for (let pixelIndex = 0; pixelIndex < width * height && bitIndex < fullBits.length; pixelIndex++) {
    const offset = pixelIndex * 4; // RGBA
    for (let channel = 0; channel < CHANNELS_PER_PIXEL && bitIndex < fullBits.length; channel++) {
      rgba[offset + channel] = (rgba[offset + channel] & 0xfe) | fullBits[bitIndex];
      bitIndex++;
    }
  }

  // ps=0 (palette size) means lossless RGBA8 output — no color quantization.
  const encoded = UPNG.encode([rgba.buffer as ArrayBuffer], width, height, 0);
  const result = Buffer.from(new Uint8Array(encoded));

  // upng-js pre-sizes its output buffer as roughly inputSize+100 bytes and
  // never grows it — for near-incompressible pixel data (confirmed: fails
  // on uniform random noise, even at moderate sizes) this silently
  // truncates the encoded PNG (missing IEND chunk) instead of throwing.
  // Real photos compress well enough to not hit this in practice, but
  // verify the actual round-trip here so any failure is loud and
  // catchable — never a silently corrupted file the sender thinks sent.
  let verification: Buffer | null = null;
  try {
    verification = extractPayload(result);
  } catch {
    verification = null;
  }
  if (!verification || !verification.equals(payload)) {
    throw new Error(
      'Failed to encode the hidden message into this image. Try a different image.',
    );
  }

  return result;
}

// Returns null if no plausible payload is found (empty image, the image
// can't be decoded at all, or the decoded length prefix doesn't fit the
// image's actual capacity) — never throws on a "no payload here" image.
export function extractPayload(pngBuffer: Buffer): Buffer | null {
  let rgba: Uint8Array, width: number, height: number;
  try {
    ({ rgba, width, height } = decodeToRgba(pngBuffer));
  } catch {
    return null;
  }
  const capacityBits = width * height * CHANNELS_PER_PIXEL;
  const lengthPrefixBits = LENGTH_PREFIX_BYTES * 8;

  if (capacityBits < lengthPrefixBits) return null;

  const lengthBits: number[] = [];
  let bitIndex = 0;
  outer: for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) {
    const offset = pixelIndex * 4;
    for (let channel = 0; channel < CHANNELS_PER_PIXEL; channel++) {
      if (bitIndex < lengthPrefixBits) lengthBits.push(rgba[offset + channel] & 1);
      bitIndex++;
      if (bitIndex >= lengthPrefixBits) break outer;
    }
  }

  const payloadLength = bitsToBytes(lengthBits).readUInt32BE(0);
  const totalBits = lengthPrefixBits + payloadLength * 8;
  if (payloadLength <= 0 || totalBits > capacityBits) return null;

  const payloadBits: number[] = [];
  bitIndex = 0;
  for (let pixelIndex = 0; pixelIndex < width * height && bitIndex < totalBits; pixelIndex++) {
    const offset = pixelIndex * 4;
    for (let channel = 0; channel < CHANNELS_PER_PIXEL && bitIndex < totalBits; channel++) {
      if (bitIndex >= lengthPrefixBits) payloadBits.push(rgba[offset + channel] & 1);
      bitIndex++;
    }
  }

  return bitsToBytes(payloadBits);
}

// Photo-library picks are usually JPEG, which is lossy — LSB steganography
// requires an untouched, lossless format. Re-renders through the image
// manipulator with no transformations, just to force a PNG re-encode.
export async function ensurePngFile(sourceUri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
  return saved.uri;
}

// RN glue: reads a source PNG from disk, embeds the payload, writes the
// result to a new cache file, and returns its URI. Call ensurePngFile()
// first if the source image's format isn't already guaranteed to be PNG.
export async function embedPayloadIntoFile(sourceUri: string, payload: Uint8Array): Promise<string> {
  const sourceFile = new File(sourceUri);
  const sourceBytes = await sourceFile.bytes();

  const embedded = embedPayload(Buffer.from(sourceBytes), Buffer.from(payload));

  const destFile = new File(Paths.cache, `covert-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  destFile.write(new Uint8Array(embedded));
  return destFile.uri;
}

export async function extractPayloadFromFile(uri: string): Promise<Uint8Array | null> {
  const file = new File(uri);
  const bytes = await file.bytes();
  const payload = extractPayload(Buffer.from(bytes));
  return payload ? new Uint8Array(payload) : null;
}
