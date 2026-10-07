import { describe, it, expect } from 'vitest';
import { FixedClock, type SubjectRef } from '@bb/domain';
import { DeclarationAppendService } from '../../understanding/declaration-append.service';
import { DeclarationReadService } from '../../understanding/declaration-read.service';
import type { DeclarationAppendCommand } from '../../understanding/declaration-ports';
import {
  emptyDeclStore,
  seedSnapshot,
  declarationUow,
  directDeclarationLog,
  snapshotViewService,
  CapturingDeclarationEventSink,
  type DeclStore,
} from './in-memory-declaration';

const A: SubjectRef = { type: 'business', id: 'A' };
const SUBJECT: SubjectRef = { type: 'offer', id: 'offer_1' };
const SK = 'understanding.snapshot.demo.audience::business:A';
const V = 'stmtver_A1';
const clock = new FixedClock('2025-01-06T04:00:00.000Z');

function appendService(store: DeclStore) {
  return new DeclarationAppendService({ uow: declarationUow(store), clock, events: new CapturingDeclarationEventSink() });
}
function cmd(over: Partial<DeclarationAppendCommand> = {}): DeclarationAppendCommand {
  return { businessRef: A, kind: 'self_report', subject: SUBJECT, statement: 'We serve local runners.', clientEventId: 'c1', ...over };
}

describe('DeclarationReadService (§8)', () => {
  it('history returns all declarations append-ordered; effectiveUnderstanding filters to eligible kinds', async () => {
    const store = emptyDeclStore();
    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'c1', kind: 'self_report', statement: 's' }));
    await svc.append(cmd({ clientEventId: 'c2', kind: 'constraint', statement: 'c' }));
    await svc.append(cmd({ clientEventId: 'c3', kind: 'intent', statement: 'i' }));
    const read = new DeclarationReadService({ declarations: directDeclarationLog(store) });
    expect((await read.history(A)).map((d) => d.kind)).toEqual(['self_report', 'constraint', 'intent']);
    expect((await read.effectiveUnderstanding(A)).map((d) => d.kind)).toEqual(['self_report', 'intent']);
  });
});

describe('lifecycle isolation — a declaration alters NO other lifecycle (§0, §3, §9)', () => {
  it('appending declarations does not change the snapshot view status, review, or recognition', async () => {
    const store = emptyDeclStore();
    seedSnapshot(store, A, { id: 'snap_A', statements: [{ semanticKey: SK, versionId: V }] });
    const before = await snapshotViewService(store).viewById(A, 'snap_A');
    expect(before.status).toBe('draft');

    // Append several declarations (including one that claims to supersede a prior one).
    const svc = appendService(store);
    const first = await svc.append(cmd({ clientEventId: 'c1', statement: 'we serve runners' }));
    await svc.append(cmd({ clientEventId: 'c2', kind: 'decision', statement: 'we will raise prices', supersedes: first.declaration.id }));

    const after = await snapshotViewService(store).viewById(A, 'snap_A');
    // Recognition, review, and status are UNTOUCHED by declarations.
    expect(after.status).toBe('draft');
    expect(after.latestReview).toBeUndefined();
    expect([...after.statementRecognitions.values()]).toEqual(['unconfirmed']);
    // The snapshot version itself is unchanged (immutable), and declaredContext stays empty.
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.snapshot.declaredContext).toEqual([]);
  });

  it('the declaration read composition performs no writes (repeated reads are stable)', async () => {
    const store = emptyDeclStore();
    const svc = appendService(store);
    await svc.append(cmd({ clientEventId: 'c1' }));
    const read = new DeclarationReadService({ declarations: directDeclarationLog(store) });
    const a = await read.history(A);
    const b = await read.history(A);
    expect(a).toEqual(b);
    expect(store.declSeq.get('business:A')).toBe(1); // no sequence movement from reads
  });
});

describe('statement-declaration link (frozen DeclarationRepository.link)', () => {
  it('links a statement semanticKey to a declaration idempotently, without changing recognition', async () => {
    const store = emptyDeclStore();
    const svc = appendService(store);
    const d = await svc.append(cmd({ clientEventId: 'c1' }));
    const log = directDeclarationLog(store);
    await log.link(A, { statementSemanticKey: SK, declarationId: d.declaration.id, createdFromExplicitSave: true });
    await log.link(A, { statementSemanticKey: SK, declarationId: d.declaration.id, createdFromExplicitSave: true }); // idempotent
    expect(store.links.size).toBe(1);
  });
});
