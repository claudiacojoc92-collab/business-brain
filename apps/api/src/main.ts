import { createServer } from './server';
import { buildCompositionRoot } from '@bb/composition';
import { createKyselyClient } from '@bb/infrastructure';
import { createRedisClient } from '@bb/infrastructure';
import { createLogger, createQueues, QueueRegistry } from '@bb/infrastructure';

const logger = createLogger({ service: 'bb-api' });

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const redisUrl    = process.env['REDIS_URL'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!redisUrl)    throw new Error('REDIS_URL is required');

  const db    = createKyselyClient(databaseUrl);
  const redis = createRedisClient(redisUrl);
  const reelQueue = new QueueRegistry(createQueues(redis)); // Slice 7 — enqueue reel process/render jobs to BullMQ

  const {
    commandBus, queryBus, jwtService, passwordService, businessService, founderAccountService,
    learnBusinessService, discoveredProfileRepo, understandingRepo, ahaRepo,
    conversationService, businessCorrectionService, aha2Service, strategyService, impactService, voiceService, planService, carouselService,
    photoLedService, photoLedRepo, reelService, reelObjectStore, reelRepo, reelShootService, reelShootRepo,
  } = buildCompositionRoot(db);

  const server = await createServer({
    db, redis, logger,
    commandBus, queryBus, jwtService, passwordService,
    businessService, founderAccountService,
    learnBusinessService, discoveredProfileRepo, understandingRepo, ahaRepo,
    conversationService, businessCorrectionService, aha2Service, strategyService, impactService, voiceService, planService, carouselService,
    photoLedService, photoLedRepo, reelService, reelObjectStore, reelRepo, reelQueue, reelShootService, reelShootRepo,
  });

  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await server.listen({ port, host });
  logger.info({ port, host }, 'API server started');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
