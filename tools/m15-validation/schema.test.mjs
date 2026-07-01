/**
 * Validation tests for the M1.5 Business Model artifact.
 * Run: node --test tools/m15-validation/schema.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateModel } from './schema.mjs';

const PROVIDED = ['website', 'instagram', 'linkedin'];              // no declared source
const WITH_DECLARED = ['website', 'podcast-interview'];             // includes a declared source

test('field with no evidence is excluded (not silently kept)', () => {
  const { model, excluded } = validateModel(
    { claimedPositioning: { value: 'x', evidenceRefs: [], confidenceKind: 'observed' } }, PROVIDED);
  assert.equal(model.claimedPositioning, undefined);
  assert.ok(excluded.some((e) => e.kind === 'field:claimedPositioning' && /at least 1|evidenceRefs/i.test(e.reason)));
});

test('evidence citing an unprovided source is excluded (fabricated provenance blocked)', () => {
  const { model, excluded } = validateModel(
    { claimedOffer: { value: 'x', evidenceRefs: [{ source: 'tiktok', fragment: 'q' }], confidenceKind: 'observed' } }, PROVIDED);
  assert.equal(model.claimedOffer, undefined);
  assert.ok(excluded.some((e) => /not in input set: tiktok/i.test(e.reason)));
});

test('declared field is rejected when no declared source was provided', () => {
  const { model, excluded } = validateModel(
    { founderClaimedIdentity: { value: 'x', evidenceRefs: [{ source: 'website', fragment: 'q' }], confidenceKind: 'declared' } }, PROVIDED);
  assert.equal(model.founderClaimedIdentity, undefined);
  assert.ok(excluded.some((e) => /declared\/spoken source/i.test(e.reason)));
});

test('coreBeliefs are rejected unless grounded in a declared source (no psychology inference)', () => {
  const { model, excluded } = validateModel(
    { coreBeliefs: [{ value: 'they believe X', evidenceRefs: [{ source: 'website', fragment: 'q' }], confidenceKind: 'observed' }] }, PROVIDED);
  assert.equal(model.coreBeliefs.length, 0);
  assert.ok(excluded.some((e) => e.kind.startsWith('field:coreBeliefs') && /declared\/spoken source/i.test(e.reason)));
});

test('marketContext citing a founder source is rejected', () => {
  const { model, excluded } = validateModel(
    { marketContext: [{ statement: 's', contextKind: 'market-pattern', confidenceKind: 'i-know', source: 'website' }] }, PROVIDED);
  assert.equal(model.marketContext.length, 0);
  assert.ok(excluded.some((e) => e.kind.startsWith('marketContext') && /must not cite a founder source/i.test(e.reason)));
});

test('valid model keeps grounded fields, declared beliefs, insights, and market context', () => {
  const { model, excluded } = validateModel({
    claimedPositioning: { value: 'calm clarity', evidenceRefs: [{ source: 'website', fragment: 'calm, clarity' }], confidenceKind: 'observed' },
    coreBeliefs: [{ value: 'clarity is respect', evidenceRefs: [{ source: 'podcast-interview', fragment: 'clarity is a form of respect' }], confidenceKind: 'declared' }],
    contradictions: [{
      statement: 'says calm, believes fury',
      contributingFields: ['claimedPositioning', 'coreBeliefs'],
      evidenceChain: [{ source: 'website', fragment: 'calm' }],
      confidenceKind: 'inferred',
    }],
    marketContext: [{ statement: 'anti-hustle is crowded', contextKind: 'category-signal', confidenceKind: 'i-know' }],
  }, WITH_DECLARED);

  assert.equal(excluded.length, 0);
  assert.equal(model.claimedPositioning.value, 'calm clarity');
  assert.equal(model.coreBeliefs.length, 1);
  assert.equal(model.contradictions.length, 1);
  assert.equal(model.marketContext.length, 1);
});
