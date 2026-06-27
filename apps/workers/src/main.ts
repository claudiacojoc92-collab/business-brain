import { createKyselyClient, createRedisClient, createBullMqConnection, createLogger } from '@bb/infrastructure';
import { MemoryAccumulatorWorker } from './memory/memory-accumulator.worker';
import { NotificationWorker }      from './notification/notification.worker';
import { AttributionWorker }       from './attribution/outcome-attribution.worker';
import { OutboxRelayWorker }       from './outbox/outbox-relay.worker';
import { ProjectionWorker }        from './projection/projection.worker';
import { SchedulerWorker }         from './scheduler/scheduler.worker';
import { DeadLetterWorker }        from './dead-letter/dead-letter.worker';
import { CleanupWorker }           from './cleanup/cleanup.worker';
import { ContentDeliveryWorker }   from './content-delivery/content-delivery.worker';
import { ContentDeliveryEnqueueSubscriber } from './content-delivery/content-delivery-enqueue.subscriber';
import { LLMPipelineWorker }         from './llm-pipeline/llm-pipeline.worker';
import { PipelineEnqueueSubscriber } from './llm-pipeline/pipeline-enqueue-subscriber';
import {
  OutboxRelay,
  InProcessEventBus,
  createQueues,
  QueueRegistry,
  createAnthropicClient,
  PromptRegistryClient,
  LLMRouter,
} from '@bb/infrastructure';

const logger = createLogger({ service: 'bb-workers' });

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const redisUrl    = process.env['REDIS_URL'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!redisUrl)    throw new Error('REDIS_URL is required');

  const db       = createKyselyClient(databaseUrl);
  const redis    = createRedisClient(redisUrl);
  const bullMq   = createBullMqConnection(redisUrl);

  // Verify connectivity
  await redis.ping();
  logger.info('Workers connected to Redis and DB');

  // Instantiate workers
  const workers = [
    new MemoryAccumulatorWorker(bullMq, db, logger),
    new NotificationWorker(bullMq, logger),
    new AttributionWorker(bullMq, db, logger),
    new ProjectionWorker(bullMq, db, logger),
    new DeadLetterWorker(bullMq, logger),
    new CleanupWorker(bullMq, logger),
  ];

  // Start all workers
  for (const worker of workers) {
    worker.start();
  }

  // Event bus (in-process routing of domain events)
  const eventBus      = new InProcessEventBus();

  // Queue registry (BullMQ producers)
  const queues        = createQueues(bullMq);
  const queueRegistry = new QueueRegistry(queues);

  // LLM infrastructure
  const anthropic      = createAnthropicClient(
    process.env['ANTHROPIC_API_KEY'] ?? '',
  );
  const promptRegistry = new PromptRegistryClient(db);
  const llmRouter      = new LLMRouter(anthropic, promptRegistry);

  // Pipeline worker (consumer)
  const pipelineWorker = new LLMPipelineWorker(
    bullMq, db, llmRouter, promptRegistry, logger,
  );
  pipelineWorker.start();

  // Pipeline enqueue subscriber (WeeklyCycleStarted domain event → BullMQ job)
  const pipelineSubscriber = new PipelineEnqueueSubscriber(
    eventBus, queueRegistry,
  );
  pipelineSubscriber.register();

  // Content Execution Layer worker (consumer) + its enqueue subscriber
  // (BriefCommitted / FallbackBriefCommitted → CONTENT_DELIVERY job).
  const contentDeliveryWorker = new ContentDeliveryWorker(
    bullMq, db, llmRouter, logger,
  );
  contentDeliveryWorker.start();

  const contentDeliverySubscriber = new ContentDeliveryEnqueueSubscriber(
    eventBus, queueRegistry,
  );
  contentDeliverySubscriber.register();

  // Outbox relay — continuous loop, publishes domain events to the in-process bus
  const outboxRelay = new OutboxRelayWorker(
    new OutboxRelay(db, eventBus),
    logger,
  );
  outboxRelay.start();

  // Scheduler — runs only if SCHEDULER=true
  if (process.env['SCHEDULER'] === 'true') {
    const scheduler = new SchedulerWorker(db, redis, logger);
    scheduler.start();
  }

  // Health server on port 3001
  const port = parseInt(process.env['WORKER_HEALTH_PORT'] ?? '3001', 10);
  const http  = await import('http');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
  server.listen(port, () => {
    logger.info({ port }, 'Worker health server started');
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down workers...');
    outboxRelay.stop();
    await pipelineWorker.close();
    await contentDeliveryWorker.close();
    for (const worker of workers) {
      await worker.close();
    }
    await db.destroy();
    redis.disconnect();
    bullMq.disconnect();
    server.close();
    logger.info('Workers shut down cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT',  () => { void shutdown(); });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal worker startup error');
  process.exit(1);
});
