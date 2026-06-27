import { describe, it, expect } from 'vitest';
import { FieldEncryptor } from '../../encryption/field-encryptor';
import { randomBytes } from 'crypto';

const TEST_KEY = randomBytes(32);

describe('FieldEncryptor', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const encryptor  = new FieldEncryptor(TEST_KEY);
    const plaintext  = 'test@example.com';
    const ciphertext = encryptor.encrypt(plaintext);
    const decrypted  = encryptor.decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const encryptor = new FieldEncryptor(TEST_KEY);
    const a = encryptor.encrypt('hello');
    const b = encryptor.encrypt('hello');
    expect(a).not.toBe(b);
  });

  it('decrypts back correctly after different IVs', () => {
    const encryptor = new FieldEncryptor(TEST_KEY);
    const a = encryptor.encrypt('same content');
    const b = encryptor.encrypt('same content');
    expect(encryptor.decrypt(a)).toBe('same content');
    expect(encryptor.decrypt(b)).toBe('same content');
  });

  it('throws if key is not 32 bytes', () => {
    expect(() => new FieldEncryptor(Buffer.from('short'))).toThrow('32-byte');
  });

  it('fromHexKey constructs from 64-character hex string', () => {
    const hexKey    = TEST_KEY.toString('hex');
    const encryptor = FieldEncryptor.fromHexKey(hexKey);
    const plain     = 'Alice Business';
    expect(encryptor.decrypt(encryptor.encrypt(plain))).toBe(plain);
  });

  it('encrypts unicode content correctly', () => {
    const encryptor = new FieldEncryptor(TEST_KEY);
    const unicode   = 'Ünïcödé Fōunδer Nämé';
    expect(encryptor.decrypt(encryptor.encrypt(unicode))).toBe(unicode);
  });
});
