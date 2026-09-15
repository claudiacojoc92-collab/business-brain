export type {
  Command,
  CommandHandler,
  ICommandBus,
} from './shared/command-bus';

export type {
  Query,
  QueryHandler,
  IQueryBus,
} from './shared/query-bus';

export type {
  EventHandler,
  IEventBus,
} from './shared/event-bus';

export type {
  Transaction,
  ITransactionManager,
} from './shared/transaction-manager';

export {
  ApplicationError,
  ValidationError,
  AuthenticationError,
  AuthorisationError,
  RateLimitError,
  IdempotencyConflict,
} from './shared/application-error';

export type { IEventStore } from './shared/event-store';
export * from './founder/index';
export * from './cycle/index';
export * from './memory/index';
export * from './campaign/index';

// Understanding→Audit vertical slice (Commit 2: fixture ingestion)
export * from './understanding/index';

// Business Brain V1 — versioned lifecycle vertical slice
export * from './businessbrain/index';

// Slice 0 — Business + Membership tenancy seam and founder account service
export * from './business/index';

// Slice 1 — "BB learned my business": website understanding + Aha 1
export * from './bi/index';

// M2 — Business Understanding: founder corrections (reuses the real founder_state path)
export * from './business-understanding/index';

// Slice 2 — "BB understood me": founder conversation + founder model + Aha 2
export * from './conversation/index';

// Slice 3 — "BB gave me a real strategy": Strategy Candidate → Proposal → Current
export * from './strategy/index';

// Slice 4 — "BB learned my voice": example-grounded Voice Model + calibration
export * from './voice/index';
// Slice 5 — "30-Day Plan + Today": Strategy → Execution
export * from './plan/index';
export * from './carousel/index';
export * from './photocarousel/index';

// Slice 7 — Reel Creation (real MP4)
export * from './reel/index';

// Slice 7 V2 — "Tell me what to film" (upstream shoot planning → frozen V1)
export * from './reel-shoot/index';

// Living State — impact evaluator + return loop (new reality → held state → explicit impact)
export * from './impact/index';
