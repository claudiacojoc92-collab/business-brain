import {
  CommandBus,
  QueryBus,
  PgFounderProfileRepository,
  PgEventStore,
  KyselyTransactionManager,
  JwtService,
  PasswordService,
  PgFounderAuthRepository,
} from '@bb/infrastructure';
import type { KyselyDB } from '@bb/infrastructure';

import {
  RegisterFounderHandler,
  AuthenticateFounderHandler,
} from '@bb/application';

export interface CompositionRoot {
  commandBus: CommandBus;
  queryBus:   QueryBus;
  jwtService: JwtService;
  passwordService: PasswordService;
}

/**
 * Wires the AUTH command/query slice only. The M2 manufactured-need machinery (cycles, campaigns,
 * intake, outcomes, recalibration, content, M2 memory) was removed in S0-T1 (Article VI). Auth is
 * DEFERRED — it retires in S0-T2 when a self-serve session replaces it; until then the CQRS buses +
 * RegisterFounder/AuthenticateFounder handlers + founder-auth repo + event store stay so the app is
 * not left authless. The ADR-007 nucleus does not use any of this (its /dev routes build their own deps).
 */
export function buildCompositionRoot(db: KyselyDB): CompositionRoot {
  const founderRepo = new PgFounderProfileRepository(db);
  const authRepo    = new PgFounderAuthRepository(db);
  const eventStore  = new PgEventStore(db);
  const defaultTxManager = new KyselyTransactionManager(db, 'system', 'system', 'system');

  const commandBus = new CommandBus();
  const queryBus   = new QueryBus();

  // Auth only.
  commandBus.register('RegisterFounder',
    new RegisterFounderHandler(founderRepo, eventStore, defaultTxManager));
  queryBus.register('AuthenticateFounder',
    new AuthenticateFounderHandler(authRepo));

  const jwtService = new JwtService(
    process.env['JWT_PRIVATE_KEY'] ?? '',
    process.env['JWT_PUBLIC_KEY']  ?? '',
  );
  const passwordService = new PasswordService();

  return { commandBus, queryBus, jwtService, passwordService };
}
