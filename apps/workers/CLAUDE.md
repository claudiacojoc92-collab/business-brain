# apps/workers (@bb/workers)

BullMQ consumers, the outbox relay, and the scheduler. Entry point is `src/main.ts`, which needs
`DATABASE_URL` and `REDIS_URL`. `SCHEDULER=true` enables the scheduler, and the health port is
`WORKER_HEALTH_PORT` (3001).

- One folder per worker: `src/<name>/<name>.worker.ts`, a class taking `(bullMq, db?, ..., logger)`
  with `start()`. Add it to `src/main.ts`. Queues come from `createQueues` / `QueueRegistry` in
  `@bb/infrastructure`.
- Enqueue-side code is a `*-enqueue.subscriber.ts` on the in-process event bus.
- The core founder loop (understanding → strategy → plan → carousel) runs synchronously in the api and
  doesn't depend on workers. Reel processing and rendering (Slice 7) do run here.
- Tests go in `src/__tests__/<worker>/`. Run them with `npx vitest run apps/workers`.
