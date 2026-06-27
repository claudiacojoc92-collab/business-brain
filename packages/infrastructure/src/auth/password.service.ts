import bcrypt from 'bcrypt';

/**
 * Password hashing service using bcrypt.
 * Cost factor: 12 (sufficient for production workloads).
 * Source: Implementation Spec V1 Section 14.
 */
export class PasswordService {
  private readonly saltRounds = 12;

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.saltRounds);
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
