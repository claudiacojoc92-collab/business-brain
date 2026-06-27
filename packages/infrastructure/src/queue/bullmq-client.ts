import { Queue } from 'bullmq';
import type { RedisClient } from '../cache/redis-client';
import { QUEUES } from '@bb/shared';

export type QueueMap = Record<string, Queue>;

/**
 * Creates BullMQ Queue instances for all 7 queues.
 * Queue names use the bb: prefix from @bb/shared constants.
 * Source: Implementation Spec V1 Section 10, Repository Structure V1 Section 10.
 */
export function createQueues(redis: RedisClient): QueueMap {
  const connection = redis;
  const queues: QueueMap = {};

  for (const name of Object.values(QUEUES)) {
    queues[name] = new Queue(name, { connection: connection as never });
  }

  return queues;
}
