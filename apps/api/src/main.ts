import { createServer } from './server';
import { createKyselyClient } from '@bb/infrastructure';
import { createRedisClient } from '@bb/infrastructure';
import { createLogger } from '@bb/infrastructure';
import { selectEmailService } from './session/email.compose';

const logger = createLogger({ service: 'bb-api' });

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  const redisUrl    = process.env['REDIS_URL'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!redisUrl)    throw new Error('REDIS_URL is required');

  const db    = createKyselyClient(databaseUrl);
  const redis = createRedisClient(redisUrl);

  // EMAIL-1: choose the magic-link adapter here (the composition root). In production this FAILS FAST if
  // Resend config is missing/invalid — a silent "sends nothing" login dead-end is worse than a loud boot
  // failure. Safe location: no test imports main.ts, so this cannot trip the prod route-registration tests.
  const email = selectEmailService(logger);

  // Auth is the self-serve magic-link session; each route module builds its own deps.
  const server = await createServer({ db, redis, logger, email });

  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await server.listen({ port, host });
  logger.info({ port, host }, 'API server started');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
