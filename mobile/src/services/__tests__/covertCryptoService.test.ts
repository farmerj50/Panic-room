import nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

import { decryptMessage, encryptMessage } from '../covertCryptoService';

describe('covertCryptoService', () => {
  test('round-trips a message between a sender and recipient key pair', () => {
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();
    const message = decodeUTF8('Meet at the usual place, 9pm.');

    const { ciphertext, nonce } = encryptMessage(message, recipient.publicKey, sender.secretKey);
    const decrypted = decryptMessage(ciphertext, nonce, sender.publicKey, recipient.secretKey);

    expect(decrypted).not.toBeNull();
    expect(encodeUTF8(decrypted!)).toBe('Meet at the usual place, 9pm.');
  });

  test('decrypting with the wrong recipient key returns null, not a throw', () => {
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();
    const wrongRecipient = nacl.box.keyPair();
    const message = decodeUTF8('secret');

    const { ciphertext, nonce } = encryptMessage(message, recipient.publicKey, sender.secretKey);
    const decrypted = decryptMessage(ciphertext, nonce, sender.publicKey, wrongRecipient.secretKey);

    expect(decrypted).toBeNull();
  });

  test('a single tampered ciphertext byte fails authentication (Poly1305 tag is checked)', () => {
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();
    const message = decodeUTF8('untampered');

    const { ciphertext, nonce } = encryptMessage(message, recipient.publicKey, sender.secretKey);
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    const decrypted = decryptMessage(tampered, nonce, sender.publicKey, recipient.secretKey);
    expect(decrypted).toBeNull();
  });

  test('each call produces a distinct nonce', () => {
    const sender = nacl.box.keyPair();
    const recipient = nacl.box.keyPair();
    const message = decodeUTF8('same message twice');

    const first = encryptMessage(message, recipient.publicKey, sender.secretKey);
    const second = encryptMessage(message, recipient.publicKey, sender.secretKey);

    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
  });
});
