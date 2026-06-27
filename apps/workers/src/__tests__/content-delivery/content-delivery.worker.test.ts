import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real KyselyTransactionManager runs `sql SELECT set_config(...)` against the tx, which a
// mock connection cannot execute. Replace ONLY it with a pass-through that hands the test's
// mock tx to the work fn; all other infra exports (repos, event store) stay real and operate on
// the mock db/tx. DB-level rollback semantics are covered by the Deferred integration spec.
const hoisted = vi.hoisted(() => ({ trx: undefined as unknown, ctorArgs: [] as unknown[][] }));
vi.mock('@bb/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bb/infrastructure')>();
  class MockTxManager {
    constructor(...args: unknown[]) { hoisted.ctorArgs.push(args); }
    async run<T>(work: (tx: unknown) => Promise<T>): Promise<T> { return work(hoisted.trx); }
  }
  return { ...actual, KyselyTransactionManager: MockTxManager };
});

import { ContentDeliveryWorker } from '../../content-delivery/content-delivery.worker';
import {
  CONTENT_READY_FOR_REVIEW,
  CONTENT_GENERATION_FAILED,
} from '../../content-delivery/content-events';

function makeBriefRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'brief-1', cycle_id: 'cycle-1', founder_id: 'founder-1',
    mode: 'AUTHORITY', mode_confidence: '0.800', mode_reason: 'r',
    belief_target_primary: 'belief-primary', belief_target_secondary: null, belief_gap_addressed: 'gap',
    audience_segment: 'seg', audience_temperature: 'WARM',
    relationship_move_type: 'NURTURE', relationship_move_desc: 'd',
    voice_parameters: { cta_style: 'INVITATION' },
    hard_blocks: [], voice_boundaries: [], offer_constraints: [],
    conviction_angle: 'angle', audience_language: { avoid_phrases: [] },
    strategic_purpose: 'purpose', campaign_id: null,
    piece_objectives: [{ role: 'REEL', objective: 'a' }, { role: 'CAROUSEL', objective: 'b' }],
    brief_confidence: '0.640', uniqueness_score: 72, validation_result: 'PASS',
    review_flag: false, memory_confidence: '0.500', recalibration_needed: false,
    is_fallback: false, committed_at: '2026-06-27T10:00:00.000Z',
    ...overrides,
  };
}

function makeDb(opts: { consumedRow?: unknown; briefRow?: unknown }) {
  const selectFrom = vi.fn((table: string) => {
    const result = table === 'app.consumed_events' ? opts.consumedRow
      : table === 'cycle.internal_briefs' ? opts.briefRow
        : undefined;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.selectAll = () => chain;
    chain.where = () => chain;
    chain.executeTakeFirst = async () => result;
    return chain;
  });
  return { selectFrom } as never;
}

function makeTrx(opts: { claimRow?: unknown }) {
  const calls = { consumed: [] as unknown[], contentPieces: [] as unknown[][], domainEvents: [] as Record<string, unknown>[][] };
  const insertInto = (table: string) => {
    if (table === 'app.consumed_events') {
      return {
        values: (v: unknown) => { calls.consumed.push(v); return {
          onConflict: () => ({ returning: () => ({ executeTakeFirst: async () => opts.claimRow }) }),
        }; },
      };
    }
    if (table === 'cycle.content_pieces') {
      return { values: (rows: unknown[]) => { calls.contentPieces.push(rows); return { execute: async () => undefined }; } };
    }
    if (table === 'app.domain_events') {
      return { values: (rows: Record<string, unknown>[]) => { calls.domainEvents.push(rows); return { execute: async () => undefined }; } };
    }
    throw new Error(`unexpected insert into ${table}`);
  };
  return { trx: { insertInto }, calls };
}

function validLlm() {
  return {
    call: vi.fn(async ({ variables }: { variables: Record<string, string> }) => {
      const po = JSON.parse(variables.PIECE_OBJECTIVE!);
      const out = po.format === 'REEL'
        ? { piece_id: po.piece_id, format: 'REEL', hook: 'h', script: 's',
            talking_points: ['one here', 'two here', 'three here'], caption: 'cap', cta: 'Join us', belief_target_ref: po.belief_target_ref }
        : { piece_id: po.piece_id, format: 'CAROUSEL',
            slides: Array.from({ length: 5 }, (_v, i) => ({ slide_number: i + 1, role: 'S', copy: `c${i}` })),
            caption: 'cap', cta: 'Join us', belief_target_ref: po.belief_target_ref };
      return { content: JSON.stringify(out) };
    }),
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const payload = {
  jobId: 'cel:evt-1', jobType: 'CONTENT_DELIVERY', correlationId: 'corr-1', traceId: 'trace-1',
  founderId: 'founder-1', enqueuedAt: 'now', eventId: 'evt-1', cycleId: 'cycle-1', briefId: 'brief-1', isFallback: false,
};

function run(worker: ContentDeliveryWorker) {
  return (worker as unknown as { process: (j: unknown) => Promise<void> }).process({ data: payload });
}

beforeEach(() => { hoisted.trx = undefined; hoisted.ctorArgs = []; });

describe('ContentDeliveryWorker — happy path', () => {
  it('persists pieces AWAITING_APPROVAL + emits ContentReadyForReview, in the founder tx', async () => {
    const t = makeTrx({ claimRow: { event_id: 'evt-1' } });
    hoisted.trx = t.trx;
    const llm = validLlm();
    const worker = new ContentDeliveryWorker({} as never, makeDb({ briefRow: makeBriefRow() }), llm as never, logger);

    await run(worker);

    expect(llm.call).toHaveBeenCalledTimes(2); // 1 reel + 1 carousel
    expect(t.calls.contentPieces).toHaveLength(1);
    const rows = t.calls.contentPieces[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.approval_status === 'AWAITING_APPROVAL')).toBe(true);
    expect(t.calls.domainEvents).toHaveLength(1);
    const evt = (t.calls.domainEvents[0] as Array<Record<string, unknown>>)[0]!;
    expect(evt.event_type).toBe(CONTENT_READY_FOR_REVIEW);
    expect(JSON.parse(evt.payload as string).piece_count).toBe(2);
    // tx opened with the real founder id (content_pieces RLS)
    expect(hoisted.ctorArgs[0]![1]).toBe('founder-1');
  });
});

describe('ContentDeliveryWorker — idempotency', () => {
  it('redelivered (already-consumed) event is a no-op: no generation, no tx', async () => {
    const t = makeTrx({ claimRow: { event_id: 'evt-1' } });
    hoisted.trx = t.trx;
    const llm = validLlm();
    const worker = new ContentDeliveryWorker(
      {} as never,
      makeDb({ consumedRow: { event_id: 'evt-1' }, briefRow: makeBriefRow() }),
      llm as never,
      logger,
    );

    await run(worker);

    expect(llm.call).not.toHaveBeenCalled();
    expect(t.calls.contentPieces).toHaveLength(0);
    expect(t.calls.domainEvents).toHaveLength(0);
  });

  it('claim race (conflict in tx) writes no pieces and emits no ready event', async () => {
    const t = makeTrx({ claimRow: undefined }); // ON CONFLICT DO NOTHING returned nothing
    hoisted.trx = t.trx;
    const worker = new ContentDeliveryWorker({} as never, makeDb({ briefRow: makeBriefRow() }), validLlm() as never, logger);

    await run(worker);

    expect(t.calls.contentPieces).toHaveLength(0);
    expect(t.calls.domainEvents).toHaveLength(0); // no ContentReadyForReview
  });
});

describe('ContentDeliveryWorker — failure', () => {
  it('NEVER-list violation: no content_pieces persisted, emits ContentGenerationFailed', async () => {
    const t = makeTrx({ claimRow: { event_id: 'evt-1' } });
    hoisted.trx = t.trx;
    const llm = {
      call: vi.fn(async ({ variables }: { variables: Record<string, string> }) => {
        const po = JSON.parse(variables.PIECE_OBJECTIVE!);
        return { content: JSON.stringify({
          piece_id: po.piece_id, format: 'REEL', hook: 'h', script: 's',
          talking_points: ['one here', 'two here', 'three here'],
          caption: 'contains forbidden text', cta: 'Join us', belief_target_ref: po.belief_target_ref,
        }) };
      }),
    };
    const worker = new ContentDeliveryWorker(
      {} as never,
      makeDb({ briefRow: makeBriefRow({ hard_blocks: ['forbidden'], piece_objectives: [{ role: 'REEL' }] }) }),
      llm as never,
      logger,
    );

    await run(worker);

    expect(t.calls.contentPieces).toHaveLength(0); // never persisted
    expect(t.calls.domainEvents).toHaveLength(1);
    expect((t.calls.domainEvents[0] as Array<Record<string, unknown>>)[0]!.event_type).toBe(CONTENT_GENERATION_FAILED);
  });

  it('missing brief: emits ContentGenerationFailed, no pieces', async () => {
    const t = makeTrx({ claimRow: { event_id: 'evt-1' } });
    hoisted.trx = t.trx;
    const worker = new ContentDeliveryWorker({} as never, makeDb({ briefRow: undefined }), validLlm() as never, logger);

    await run(worker);

    expect(t.calls.contentPieces).toHaveLength(0);
    expect((t.calls.domainEvents[0] as Array<Record<string, unknown>>)[0]!.event_type).toBe(CONTENT_GENERATION_FAILED);
  });
});
