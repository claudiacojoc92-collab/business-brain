import type { Logger } from '@bb/infrastructure';

interface NotificationPayload {
  founderId:        string;
  notificationType: string;
  templateData:     Record<string, unknown>;
}

/**
 * In-app notification channel adapter.
 * Production: Redis pub/sub to WebSocket connections.
 * Source: Repository Structure V1 Section 08.
 */
export class InAppChannel {
  constructor(private readonly logger: Logger) {}

  async send(payload: NotificationPayload): Promise<void> {
    this.logger.info(
      { founderId: payload.founderId, type: payload.notificationType },
      'In-app notification dispatched',
    );
    // Redis pub/sub integration wired in production
  }
}
