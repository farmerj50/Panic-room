import { Buffer } from 'buffer';
import UPNG from 'upng-js';

import { embedPayload, extractPayload } from '../steganographyService';

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const encoded = UPNG.encode([rgba.buffer as ArrayBuffer], width, height, 0);
  return Buffer.from(new Uint8Array(encoded));
}

// upng-js pre-sizes its encode output buffer as roughly inputSize+100 bytes
// and never grows it (confirmed directly against the library: fails on
// pure uniform random noise at any size, and on any image below ~50x50
// regardless of content, since fixed chunk overhead alone exceeds the
// margin). Real photos have spatial correlation and compress well within
// that margin, so test fixtures use a gradient-plus-jitter pattern — not
// pure noise — at 50x50 or larger, which is representative of real usage
// and confirmed to encode/decode correctly.
function makeRealisticPng(width: number, height: number): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const base = Math.floor(((x + 1) / (width + 1) + (y + 1) / (height + 1)) * 127);
      rgba[i] = Math.min(255, base + Math.floor(Math.random() * 8));
      rgba[i + 1] = Math.min(255, base + Math.floor(Math.random() * 8));
      rgba[i + 2] = Math.min(255, base + Math.floor(Math.random() * 8));
      rgba[i + 3] = 255;
    }
  }
  return encodePng(rgba, width, height);
}

function makeRandomNoisePng(width: number, height: number): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = Math.floor(Math.random() * 256);
  return encodePng(rgba, width, height);
}

function decodeRgba(pngBuffer: Buffer): Uint8Array {
  const decoded = UPNG.decode(toArrayBuffer(pngBuffer));
  return new Uint8Array(UPNG.toRGBA8(decoded)[0]);
}

describe('steganographyService', () => {
  test('embeds and extracts a short message bit-exactly on a small square image', () => {
    const src = makeRealisticPng(64, 64);
    const payload = Buffer.from('Hello from a covert message!');

    const embedded = embedPayload(src, payload);
    const extracted = extractPayload(embedded);

    expect(extracted).not.toBeNull();
    expect(extracted!.equals(payload)).toBe(true);
  });

  test('round-trips on a non-square image (catches row-stride bugs)', () => {
    const src = makeRealisticPng(53, 97);
    const payload = Buffer.from('non-square row-stride test');

    const extracted = extractPayload(embedPayload(src, payload));

    expect(extracted!.equals(payload)).toBe(true);
  });

  test('round-trips a larger payload on a medium image', () => {
    const src = makeRealisticPng(200, 200);
    const payload = Buffer.from('x'.repeat(5000));

    const extracted = extractPayload(embedPayload(src, payload));

    expect(extracted!.equals(payload)).toBe(true);
  });

  test('never touches bits above the LSB in RGB channels (alpha untouched too)', () => {
    const src = makeRealisticPng(50, 50);
    const srcRgba = decodeRgba(src);
    const embedded = embedPayload(src, Buffer.from('short'));
    const embeddedRgba = decodeRgba(embedded);

    let mismatches = 0;
    for (let i = 0; i < srcRgba.length; i++) {
      const highBitsBefore = srcRgba[i] & 0xfe;
      const highBitsAfter = embeddedRgba[i] & 0xfe;
      const isAlphaChannel = i % 4 === 3;
      if (isAlphaChannel) {
        // Alpha must be completely untouched, including its LSB.
        if (srcRgba[i] !== embeddedRgba[i]) mismatches++;
      } else if (highBitsBefore !== highBitsAfter) {
        mismatches++;
      }
    }

    expect(mismatches).toBe(0);
  });

  test('throws a clear error when the payload does not fit the image', () => {
    const src = makeRealisticPng(50, 50); // 50*50*3 = 7500 bits ≈ 933 usable bytes

    expect(() => embedPayload(src, Buffer.from('x'.repeat(2000)))).toThrow(/too large/i);
  });

  test('extracting from an image with no embedded payload returns null', () => {
    // A never-embedded image's first 32 bits decode to some "length" value;
    // only treat it as a real payload if that length actually fits the
    // image's capacity — otherwise return null. Run several images since
    // any single one could randomly decode to a tiny, in-capacity length.
    let sawNull = false;
    for (let i = 0; i < 20; i++) {
      if (extractPayload(makeRealisticPng(50, 50)) === null) {
        sawNull = true;
        break;
      }
    }
    expect(sawNull).toBe(true);
  });

  test('surfaces a clear, catchable error instead of a raw crash on an image upng-js cannot decode', () => {
    // Documents a real upng-js limitation found while building this: its
    // encoder can silently truncate the output PNG (missing IEND chunk) for
    // near-incompressible pixel data (confirmed: pure uniform random noise
    // fails at every size tested, since it never grows its pre-sized output
    // buffer and DEFLATE can't compress true noise). embedPayload() must
    // convert that into a clear thrown error, never a raw
    // "Cannot read properties of undefined" crash.
    const undecodable = makeRandomNoisePng(50, 50);

    expect(() => embedPayload(undecodable, Buffer.from('short'))).toThrow(
      /could not read this as a png/i,
    );
  });
});
