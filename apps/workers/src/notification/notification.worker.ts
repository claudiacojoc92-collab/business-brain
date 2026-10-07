import { Worker, type Job } from 'bullmq';
import type { RedisClient, Logger } from '@bb/infrastructure';
import { QUEUES } from '@bb/shared';
import { EmailChannel }   from './channels/email.channel';
import { InAppChannel }   from './channels/in-app.channel';
import { PushChannel }    from './channels/push.channel';

/**
 * Routes notifications to the correct channel adapter.
 * Retry: 5 attempts, 30s linear backoff.
 * Source: Repository Structure V1 Section 08.
 */
export class NotificationWorker {
  private worker:      Worker | null = null;
  private readonly email: EmailChannel;
  private readonly inApp: InAppChannel;
  private readonly push:  PushChannel;

  constructor(
    private readonly redis:  RedisClient,
    private readonly logger: Logger,
  ) {
    this.email = new EmailChannel(logger);
    this.inApp = new InAppChannel(logger);
    this.push  = new PushChannel(logger);
  }

  start(): void {
    this.worker = new Worker(
      QUEUES.NOTIFICATIONS,
      this.process.bind(this),
      { connection: this.redis as never, concurrency: 20 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err }, 'Notification job failed');
    });
    this.logger.info('NotificationWorker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job): Promise<void> {
    const payload = job.data as {
      channel:          'EMAIL' | 'IN_APP' | 'PUSH';
      notificationType: string;
      founderId:        string;
      templateData:     Record<string, unknown>;
    };

    this.logger.info(
      { founderId: payload.founderId, type: payload.notificationType, channel: payload.channel },
      'Sending notification',
    );

    switch (payload.channel) {
      case 'EMAIL':   await this.email.send(payload); break;
      case 'IN_APP':  await this.inApp.send(payload); break;
      case 'PUSH':    await this.push.send(payload);  break;
    }
  }
}
