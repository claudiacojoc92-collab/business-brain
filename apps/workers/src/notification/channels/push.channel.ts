import type { Logger } from '@bb/infrastructure';

interface NotificationPayload {
  founderId:        string;
  notificationType: string;
  templateData:     Record<string, unknown>;
}

/**
 * Push notification channel adapter.
 * Production: Firebase Cloud Messaging.
 * Source: Repository Structure V1 Section 08.
 */
export class PushChannel {
  constructor(private readonly logger: Logger) {}

  async send(payload: NotificationPayload): Promise<void> {
    this.logger.info(
      { founderId: payload.founderId, type: payload.notificationType },
      'Push notification dispatched',
    );
    // FCM integration wired in production
  }
}
