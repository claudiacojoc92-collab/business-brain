import { ApplicationError } from '@bb/shared';
import { generateId } from '@bb/shared';
import type { Clock, DeclarationKind, FounderDeclaration, SubjectRef } from '@bb/domain';
import type {
  DeclarationAppendCommand,
  DeclarationAppendOutcome,
  DeclarationAppendResult,
  DeclarationEventSink,
  DeclarationRepos,
  DeclarationUnitOfWork,
} from './declaration-ports';

const VALID_KINDS: ReadonlySet<DeclarationKind> = new Set<DeclarationKind>([
  'self_report',
  'intent',
  'decision',
  'objective',
  'preference',
  'constraint',
]);

export interface IDeclarationAppendService {
  append(command: DeclarationAppendCommand): Promise<DeclarationAppendResult>;
}

/**
 * Appends an explicit founder declaration to the append-only log. A declaration records WHAT THE FOUNDER
 * DECLARED — it is never verified truth, recognition, review, presentation, correction, evidence, or a
 * confidence/status change. This service therefore appends to the declaration log ONLY: it reads no
 * snapshot, touches no recognition/review/presentation store, and derives no status. The founder's own
 * `supersedes` pointer is recorded verbatim, never resolved.
 *
 * Validation is STRUCTURAL only (allowed kind, non-empty statement) — a declaration is business-scoped and
 * references no snapshot/statement, so nothing is looked up and no truth is asserted. Idempotency/conflict
 * are business-scoped by clientEventId (Commits 5–7 discipline); no raw persistence error is exposed.
 */
export class DeclarationAppendService implements IDeclarationAppendService {
  constructor(
    private readonly deps: {
      readonly uow: DeclarationUnitOfWork;
      readonly clock: Clock;
      readonly events: DeclarationEventSink;
    },
  ) {}

  async append(command: DeclarationAppendCommand): Promise<DeclarationAppendResult> {
    if (!VALID_KINDS.has(command.kind)) {
      throw new ApplicationError('DECLARATION_INVALID_PAYLOAD', `Unsupported declaration kind: ${command.kind}.`, 422);
    }
    if (command.statement.trim().length === 0) {
      throw new ApplicationError('DECLARATION_INVALID_PAYLOAD', 'A declaration statement must not be empty.', 422);
    }

    const outcome = await this.deps.uow.run(command.businessRef, async (repos) => this.applyWithin(command, repos));

    switch (outcome.kind) {
      case 'client_event_conflict':
        throw new ApplicationError(
          'DECLARATION_CLIENT_EVENT_CONFLICT',
          `clientEventId ${command.clientEventId} was already used for a different declaration.`,
          409,
        );
      case 'declaration_id_conflict':
        throw new ApplicationError('DECLARATION_ID_CONFLICT', 'A declaration id collided with conflicting content.', 500);
      case 'replayed':
        return { declaration: outcome.stored, replayed: true };
      case 'created':
        this.deps.events.declarationAppended({
          businessRef: command.businessRef,
          declarationId: outcome.stored.id,
          kind: outcome.stored.kind,
          replayed: false,
        });
        return { declaration: outcome.stored, replayed: false };
    }
  }

  private async applyWithin(command: DeclarationAppendCommand, repos: DeclarationRepos): Promise<DeclarationAppendOutcome> {
    // 1. Business-scoped replay/conflict resolution BEFORE minting server identity/time.
    const prior = await repos.declarations.findByClientEventId(command.businessRef, command.clientEventId);
    if (prior) {
      return sameIntent(prior, command) ? { kind: 'replayed', stored: prior } : { kind: 'client_event_conflict' };
    }

    // 2. Mint server-owned identity/time AFTER replay is resolved. provenance is ALWAYS 'founder_declared'.
    const declaration: FounderDeclaration = {
      id: generateId(),
      businessRef: command.businessRef,
      kind: command.kind,
      subject: command.subject,
      statement: command.statement,
      provenance: 'founder_declared',
      declaredAt: this.deps.clock.now(),
      ...(command.supersedes !== undefined ? { supersedes: command.supersedes } : {}),
    };

    // 3. Race-safe authoritative write under the per-business append-sequence lock.
    return repos.declarations.appendIdempotent(command.businessRef, declaration, command.clientEventId);
  }
}

/**
 * Immutable founder-owned intent: kind + subject + statement + supersedes pointer (businessRef is the scope,
 * clientEventId equal by lookup, provenance a constant). Server-assigned id, `declaredAt`, and append
 * sequence do NOT participate — a genuine retry must classify as replay, not conflict.
 */
function sameIntent(prior: FounderDeclaration, command: DeclarationAppendCommand): boolean {
  return (
    prior.kind === command.kind &&
    sameRef(prior.subject, command.subject) &&
    prior.statement === command.statement &&
    (prior.supersedes ?? undefined) === (command.supersedes ?? undefined)
  );
}

function sameRef(a: SubjectRef, b: SubjectRef): boolean {
  return a.type === b.type && a.id === b.id;
}
