import { describe, it, expect } from 'vitest';
import {
  buildContextSnapshot, computeContextSnapshotHash, canonicalSerialize, sha256Hex, verifyContextSnapshotIntegrity,
  snapshotToFrozenContext, toRecommendationInput, toSnapshotView, SNAPSHOT_PAYLOAD_SCHEMA_VERSION, SNAPSHOT_HASH_ALGORITHM,
  type ContextSnapshot, type FrozenBusinessUnderstanding, type FrozenFounderContext, type FrozenPublicPositioning, type SnapshotProvenance,
} from '../../business-model/context-snapshot';

/**
 * Wave 4 — PURE deterministic tests for the Consumption Gate REMEDIATION (ADR-014 amendment). The snapshot is an immutable
 * value whose authoritative integrity hash is SHA-256 over a canonical serialization: deterministic, key-order-stable,
 * array-order-sensitive, content-sensitive, and server-computed. Projections return the FULL frozen payload (BU + FSC +
 * public-positioning) verbatim. The mandatory-gate/provenance/no-live-fallback behaviour is in the live test.
 */
function bu(over: Partial<FrozenBusinessUnderstanding> = {}): FrozenBusinessUnderstanding {
  return { version: 3, conclusions: [{ id: 'c1', type: 'what_it_is', statement: 'A SaaS.', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 1 }], founderResponses: [], conflicts: [], unknowns: [], ...over };
}
function fsc(over: Partial<FrozenFounderContext> = {}): FrozenFounderContext {
  return { goals: [], constraints: [], resources: [], strategicPreferences: [], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [], promotedLearnings: [], ...over } as FrozenFounderContext;
}
function ppc(over: Partial<FrozenPublicPositioning> = {}): FrozenPublicPositioning {
  return { entities: [], observations: [], inferences: [], provisional: { observations: 0, inferences: 0 }, provenance: [], ...over } as FrozenPublicPositioning;
}
const prov: SnapshotProvenance = { businessUnderstanding: [{ conclusionId: 'c1', sourceType: 'NATIVE_BUSINESS_UNDERSTANDING' }], founderStrategicContext: [], publicPositioning: [] };
function snap(over: Partial<ContextSnapshot> = {}): ContextSnapshot {
  const f = buildContextSnapshot(bu(), fsc(), ppc(), prov);
  return { id: 's1', founderId: 'f1', createdAt: '2026-07-21T00:00:00.000Z', ...f, ...over };
}

describe('context snapshot — SHA-256 canonical integrity hash (R6)', () => {
  it('36. the hash is 64 lowercase hex chars, server-computed', () => {
    const h = computeContextSnapshotHash({ businessUnderstanding: bu(), founderStrategicContext: fsc(), publicPositioningContext: ppc(), provenance: prov, payloadSchemaVersion: SNAPSHOT_PAYLOAD_SCHEMA_VERSION });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); // known SHA-256 vector
  });
  it('37/38. same semantic payload / different key order → same hash', () => {
    const a = computeContextSnapshotHash({ businessUnderstanding: bu(), founderStrategicContext: fsc(), publicPositioningContext: ppc(), provenance: prov, payloadSchemaVersion: SNAPSHOT_PAYLOAD_SCHEMA_VERSION });
    const b = computeContextSnapshotHash({ payloadSchemaVersion: SNAPSHOT_PAYLOAD_SCHEMA_VERSION, provenance: prov, publicPositioningContext: ppc(), founderStrategicContext: fsc(), businessUnderstanding: { conclusions: bu().conclusions, unknowns: [], conflicts: [], founderResponses: [], version: 3 } });
    expect(a).toBe(b);
  });
  it('39. array-order change → different hash', () => {
    const two = [{ id: 'a', type: 't', statement: 's1', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 0 }, { id: 'b', type: 't', statement: 's2', epistemicStatus: 'OBSERVED', group: 'primary', evidenceCount: 0 }];
    const h1 = computeContextSnapshotHash({ businessUnderstanding: bu({ conclusions: two }), founderStrategicContext: fsc(), publicPositioningContext: ppc(), provenance: prov, payloadSchemaVersion: SNAPSHOT_PAYLOAD_SCHEMA_VERSION });
    const h2 = computeContextSnapshotHash({ businessUnderstanding: bu({ conclusions: [two[1]!, two[0]!] }), founderStrategicContext: fsc(), publicPositioningContext: ppc(), provenance: prov, payloadSchemaVersion: SNAPSHOT_PAYLOAD_SCHEMA_VERSION });
    expect(h1).not.toBe(h2);
  });
  it('40. content change (a promoted conclusion) → different hash', () => {
    const base = snap().contentHash;
    const changed = buildContextSnapshot(bu({ conclusions: [...bu().conclusions, { id: 'promoted-e1', type: 'promoted_learning', statement: 'Outreach converts.', epistemicStatus: 'SUPPORTED', group: 'promoted_learning', evidenceCount: 0 }] }), fsc(), ppc(), prov).contentHash;
    expect(changed).not.toBe(base);
  });
  it('canonicalSerialize rejects unsupported values (undefined / NaN / function)', () => {
    expect(() => canonicalSerialize({ a: undefined })).toThrow(/unsupported/);
    expect(() => canonicalSerialize({ a: NaN })).toThrow(/non-finite/);
    expect(() => canonicalSerialize({ a: () => 1 })).toThrow(/unsupported/);
  });
  it('42. stored hash recomputes correctly; a tampered payload fails integrity', () => {
    const s = snap();
    expect(verifyContextSnapshotIntegrity(s)).toBe(true);
    expect(verifyContextSnapshotIntegrity({ ...s, businessUnderstanding: bu({ version: 999 }) })).toBe(false); // tampered
    expect(verifyContextSnapshotIntegrity({ ...s, contentHash: 'deadbeef' })).toBe(false);
  });
  it('35. buildContextSnapshot stamps schema version + sha256 algorithm', () => {
    const f = buildContextSnapshot(bu(), fsc(), ppc(), prov);
    expect(f.payloadSchemaVersion).toBe(SNAPSHOT_PAYLOAD_SCHEMA_VERSION);
    expect(f.hashAlgorithm).toBe(SNAPSHOT_HASH_ALGORITHM);
    expect(f.hashAlgorithm).toBe('sha256');
  });
});

describe('context snapshot — full frozen payload projections (R4)', () => {
  it('snapshotToFrozenContext returns BU + founderContext + public-positioning verbatim (no live reads)', () => {
    const s = snap();
    const frozen = snapshotToFrozenContext(s);
    expect(frozen.businessUnderstanding).toBe(s.businessUnderstanding);
    expect(frozen.founderContext).toBe(s.founderStrategicContext);
    expect(frozen.publicPositioningContext).toBe(s.publicPositioningContext);
  });
  it('toRecommendationInput carries the snapshot id + full frozen payload + timestamp (L7)', () => {
    const s = snap();
    expect(toRecommendationInput(s)).toEqual({ snapshotId: 's1', businessUnderstanding: s.businessUnderstanding, founderStrategicContext: s.founderStrategicContext, publicPositioningContext: s.publicPositioningContext, provenance: s.provenance, snapshotTimestamp: s.createdAt });
  });
  it('32. public-positioning provenance survives the freeze', () => {
    const s = snap({ ...buildContextSnapshot(bu(), fsc(), ppc({ entities: [{ id: 'e1', name: 'Acme', entityType: 'competitor', websiteUrl: null }] as never }), { ...prov, publicPositioning: [{ findingId: 'fnd1', reviewId: 'rev1', adapter: 'fixture', model: null, promptVersion: null }] }), id: 's1', founderId: 'f1', createdAt: '2026-07-21T00:00:00.000Z' });
    expect(toSnapshotView(s).publicPositioning.entities).toBe(1);
    expect(s.provenance.publicPositioning[0]!.findingId).toBe('fnd1');
  });
});

describe('context snapshot — founder-safe view regenerates nothing', () => {
  it('toSnapshotView exposes hash + algorithm + schema and reports it changes/regenerates nothing', () => {
    const v = toSnapshotView(snap());
    expect(v.doesNotModifyContext).toBe(true); expect(v.doesNotModifyLearning).toBe(true); expect(v.doesNotRegenerate).toBe(true);
    expect(v.contentHash).toMatch(/^[0-9a-f]{64}$/); expect(v.hashAlgorithm).toBe('sha256'); expect(v.payloadSchemaVersion).toBe(SNAPSHOT_PAYLOAD_SCHEMA_VERSION);
    for (const forbidden of ['status', 'progress', 'score']) expect(Object.keys(v)).not.toContain(forbidden);
  });
});
