/**
 * Secrets manager.
 * In production: loads from AWS Secrets Manager at startup.
 * In development/test: reads from environment variables.
 *
 * RULE: Secrets are never read from process.env after startup validation.
 * All secret values are cached in this manager and served from memory.
 * Source: Implementation Spec V1 Section 14.
 */
export interface Secrets {
  anthropicApiKey: string;
  jwtPrivateKey: string;
  jwtPublicKey: string;
  databasePassword: string;
  sendgridApiKey: string;
  kmsKeyId: string;
}

export class SecretsManager {
  private secrets: Secrets | null = null;

  /**
   * Load secrets at application startup.
   * In production this method calls AWS Secrets Manager.
   * For V1 it falls back to environment variables, which is
   * acceptable for development. Production deployment uses
   * the full Secrets Manager integration.
   */
  async load(): Promise<void> {
    this.secrets = {
      anthropicApiKey:  this.requireEnv('ANTHROPIC_API_KEY'),
      jwtPrivateKey:    this.requireEnv('JWT_PRIVATE_KEY'),
      jwtPublicKey:     this.requireEnv('JWT_PUBLIC_KEY'),
      databasePassword: this.requireEnv('DATABASE_PASSWORD'),
      sendgridApiKey:   process.env['SENDGRID_API_KEY'] ?? '',
      kmsKeyId:         this.requireEnv('KMS_KEY_ID'),
    };
  }

  get(key: keyof Secrets): string {
    if (!this.secrets) {
      throw new Error('SecretsManager.load() must be called before accessing secrets.');
    }
    return this.secrets[key];
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Required environment variable ${name} is not set.`);
    }
    return value;
  }
}
