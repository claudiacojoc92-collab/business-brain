import type { KyselyDB } from '../database/client';
import type { RedisClient } from '../cache/redis-client';

export type HealthStatus = 'ok' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  status: HealthStatus;
  checks: Record<string, { status: HealthStatus; latencyMs?: number; error?: string }>;
}

/**
 * Runs liveness and readiness health checks.
 * Used by the API and Worker /health endpoints.
 * Source: Implementation Spec V1 Section 12, Repository Structure V1 Section 08.
 */
export class HealthChecks {
  constructor(
    private readonly db: KyselyDB,
    private readonly redis: RedisClient,
  ) {}

  /** Liveness: is the process alive? Always returns ok unless the process is broken. */
  async liveness(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      checks: { process: { status: 'ok' } },
    };
  }

  /** Readiness: can the process serve traffic? Checks DB and Redis. */
  async readiness(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};

    // DB check
    const dbStart = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db as any).raw('SELECT 1').execute();
      checks['database'] = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (error) {
      checks['database'] = {
        status:  'unhealthy',
        latencyMs: Date.now() - dbStart,
        error:   error instanceof Error ? error.message : String(error),
      };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      await this.redis.ping();
      checks['redis'] = { status: 'ok', latencyMs: Date.now() - redisStart };
    } catch (error) {
      checks['redis'] = {
        status:  'unhealthy',
        latencyMs: Date.now() - redisStart,
        error:   error instanceof Error ? error.message : String(error),
      };
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok');
    return {
      status: allOk ? 'ok' : 'unhealthy',
      checks,
    };
  }
}
