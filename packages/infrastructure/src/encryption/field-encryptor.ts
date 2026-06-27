import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM field-level encryption for PII fields.
 *
 * Output format: base64(iv_12_bytes + auth_tag_16_bytes + ciphertext)
 * Total prefix before ciphertext: 28 bytes.
 *
 * KMS integration is deferred to a separate milestone.
 * For V1 the key is derived from the KMS_KEY_ID environment variable
 * as a local development key. Production uses KMS data keys.
 *
 * Encrypted fields: email, name, business_name in founder.founders,
 * original_fragment / replacement_fragment in cycle.content_edits.
 *
 * Source: Implementation Spec V1 Section 14.
 */
export class FieldEncryptor {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength  = 12;
  private readonly tagLength = 16;

  constructor(private readonly keyBuffer: Buffer) {
    if (keyBuffer.length !== 32) {
      throw new Error('FieldEncryptor requires a 32-byte (256-bit) key.');
    }
  }

  encrypt(plaintext: string): string {
    const iv         = randomBytes(this.ivLength);
    const cipher     = createCipheriv(this.algorithm, this.keyBuffer, iv, {
      authTagLength: this.tagLength,
    });
    const encrypted  = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag    = cipher.getAuthTag();
    const combined   = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  }

  decrypt(ciphertext: string): string {
    const combined   = Buffer.from(ciphertext, 'base64');
    const iv         = combined.subarray(0, this.ivLength);
    const authTag    = combined.subarray(this.ivLength, this.ivLength + this.tagLength);
    const encrypted  = combined.subarray(this.ivLength + this.tagLength);
    const decipher   = createDecipheriv(this.algorithm, this.keyBuffer, iv, {
      authTagLength: this.tagLength,
    });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  /**
   * Creates a FieldEncryptor from a 32-character hex string key.
   * For development only — production uses KMS data keys.
   */
  static fromHexKey(hexKey: string): FieldEncryptor {
    return new FieldEncryptor(Buffer.from(hexKey, 'hex'));
  }
}
