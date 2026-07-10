import { createServer } from './server';
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

  // No composition root: the M2 auth bridge (CQRS buses + Jwt/Password) was retired in S0-T2 C3.
  // Auth is the self-serve magic-link session; each route module builds its own deps.
  const server = await createServer({ db, redis, logger });

  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await server.listen({ port, host });
  logger.info({ port, host }, 'API server started');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
