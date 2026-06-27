import { createServer } from './server';
import { buildCompositionRoot } from './composition-root';
import { createKyselyClient } from '@bb/infrastructure';
import { createRedisClient } from '@bb/infrastructure';
import { createLogger } from '@bb/infrastructure';

const logger = createLogger({ service: 'bb-api' });

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const redisUrl    = process.env['REDIS_URL'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!redisUrl)    throw new Error('REDIS_URL is required');

  const db    = createKyselyClient(databaseUrl);
  const redis = createRedisClient(redisUrl);

  const { commandBus, queryBus, jwtService, passwordService } =
    buildCompositionRoot(db);

  const server = await createServer({
    db, redis, logger,
    commandBus, queryBus, jwtService, passwordService,
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
