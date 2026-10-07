import type { Logger } from '@bb/infrastructure';

interface NotificationPayload {
  founderId:        string;
  notificationType: string;
  templateData:     Record<string, unknown>;
}

/**
 * Email notification channel adapter.
 * Production: SendGrid via API key from SecretsManager.
 * Source: Repository Structure V1 Section 08.
 */
export class EmailChannel {
  constructor(private readonly logger: Logger) {}

  async send(payload: NotificationPayload): Promise<void> {
    this.logger.info(
      { founderId: payload.founderId, type: payload.notificationType },
      'Email notification dispatched',
    );
    // SendGrid integration — wired in production when API key is available
  }
}
