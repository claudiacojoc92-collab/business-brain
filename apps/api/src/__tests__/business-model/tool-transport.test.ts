import { describe, it, expect } from 'vitest';
import {
  buildBusinessModelTool, BUSINESS_MODEL_TOOL_NAME, envelopeGate, artifactFromToolCall,
} from '../../business-model/recompute';
import { GenerationError } from '../../business-model/generation-errors';

/**
 * RJ-1 C2 — the model-output transport boundary. The P0: a free-text response failed JSON.parse
 * (`SyntaxError … position 3673`) after ~110s and 500'd. The artifact now arrives as tool input
 * (already parsed by the SDK), so malformed JSON cannot reach us; every non-conforming shape fails
 * CLOSED with `invalid_model_output`. There is deliberately NO free-text fallback.
 *
 * Deterministic: no live model. The frozen engine files are untouched (asserted in the gate run).
 */
const FIELD = { value: 'v', evidenceRefs: [{ source: 's', fragment: 'f' }], confidenceKind: 'observed' };
const VALID = { claimedPositioning: FIELD, coreBeliefs: [], contradictions: [], modelConfidence: 'thin' };
const toolBlock = (input: unknown, name = BUSINESS_MODEL_TOOL_NAME) => ({ type: 'tool_use', name, input });

describe('tool definition — top-level transport shape only', () => {
  it('declares every artifact key, all optional (absence is constitutional), object at root', () => {
    const t = buildBusinessModelTool();
    expect(t.name).toBe(BUSINESS_MODEL_TOOL_NAME);
    expect(t.input_schema.type).toBe('object');
    expect(t.input_schema.properties['claimedPositioning']).toEqual({ type: 'object' });
    expect(t.input_schema.properties['contradictions']).toEqual({ type: 'array' });
    expect(t.input_schema.properties['modelConfidence']).toEqual({ type: 'string' });
    // No `required` — the frozen prompt mandates omitting ungrounded registers.
    expect((t.input_schema as Record<string, unknown>)['required']).toBeUndefined();
  });
});

describe('envelope gate — transport shape, not epistemics', () => {
  it('accepts a valid artifact', () => expect(envelopeGate(VALID)).toEqual({ ok: true }));
  it('accepts an honestly-degraded artifact (only modelConfidence)', () => {
    expect(envelopeGate({ modelConfidence: 'nothing groundable' })).toEqual({ ok: true });
  });

  for (const [label, bad] of [
    ['string', 'nope'], ['array', [1]], ['null', null], ['number', 7],
    ['empty object', {}],
    ['unknown keys only', { foo: 1 }],
    ['wrong container (array→object)', { coreBeliefs: {} }],
    ['wrong container (object→array)', { claimedPositioning: [] }],
    ['modelConfidence not a string', { modelConfidence: 5 }],
  ] as Array<[string, unknown]>) {
    it(`rejects: ${label}`, () => expect(envelopeGate(bad).ok).toBe(false));
  }

  it('rejects prototype-polluting keys', () => {
    expect(envelopeGate(JSON.parse('{"__proto__":{"x":1},"modelConfidence":"c"}')).ok).toBe(false);
  });

  it('rejects an oversized array (size cap)', () => {
    expect(envelopeGate({ contradictions: new Array(201).fill({}) }).ok).toBe(false);
  });

  it('unknown keys do not COUNT toward the recognized-key requirement (fail closed)', () => {
    expect(envelopeGate({ foo: 1, bar: 2 }).ok).toBe(false);          // unknown-only → rejected
    expect(envelopeGate({ foo: 1, modelConfidence: 'c' }).ok).toBe(true); // ignored alongside a recognized key
  });

  // REGRESSION (caught live against real evidence): the gate MUST NOT be stricter than the frozen
  // validator. Frozen uses `raw[key] == null` — loose — so null ≡ absent ≡ honest degradation, and
  // coerces a non-array to []. Rejecting `founderClaimedIdentity: null` produced a FALSE 502.
  it('null ≡ absent for a single field (frozen `== null` semantics) — must NOT reject', () => {
    expect(envelopeGate({ founderClaimedIdentity: null, claimedPositioning: FIELD }).ok).toBe(true);
  });
  it('null ≡ empty for an array field — must NOT reject', () => {
    expect(envelopeGate({ coreBeliefs: null, modelConfidence: 'thin' }).ok).toBe(true);
  });
  it('null modelConfidence ≡ absent — must NOT reject', () => {
    expect(envelopeGate({ claimedPositioning: FIELD, modelConfidence: null }).ok).toBe(true);
  });
  it('an all-null artifact still fails closed (it would persist an empty Read)', () => {
    expect(envelopeGate({ claimedPositioning: null, coreBeliefs: null }).ok).toBe(false);
  });
});

describe('artifactFromToolCall — exactly one expected tool call, else fail closed', () => {
  it('returns the parsed input for exactly one valid tool call', () => {
    expect(artifactFromToolCall([toolBlock(VALID)])).toEqual(VALID);
  });

  it('NO tool call → invalid_model_output', () => {
    expect(() => artifactFromToolCall([])).toThrow(GenerationError);
    try { artifactFromToolCall([]); } catch (e) {
      expect((e as GenerationError).reason).toBe('invalid_model_output');
      expect((e as GenerationError).stage).toBe('tool_input');
    }
  });

  it('PROSE instead of the tool → invalid_model_output (no free-text fallback)', () => {
    const prose = [{ type: 'text', text: '{"claimedPositioning": {"value":"v"}}' }];
    expect(() => artifactFromToolCall(prose)).toThrow(/no business_model tool call/);
  });

  it('MULTIPLE tool calls → invalid_model_output', () => {
    expect(() => artifactFromToolCall([toolBlock(VALID), toolBlock(VALID)])).toThrow(/expected exactly 1/);
  });

  it('a different tool name is not accepted', () => {
    expect(() => artifactFromToolCall([toolBlock(VALID, 'something_else')])).toThrow(GenerationError);
  });

  it('schema-invalid tool input → invalid_model_output at the gate', () => {
    try { artifactFromToolCall([toolBlock({ coreBeliefs: 'not-an-array' })]); expect.unreachable(); } catch (e) {
      expect((e as GenerationError).stage).toBe('envelope_gate');
      expect((e as GenerationError).reason).toBe('invalid_model_output');
    }
  });

  it('non-object tool input → fails closed', () => {
    expect(() => artifactFromToolCall([toolBlock('a string')])).toThrow(/not a plain object/);
  });

  // THE P0, deterministically: free text that cannot be parsed can no longer reach the artifact
  // path at all — it is simply "no tool call". Fixture mirrors the production failure shape.
  it('FLOURISH REPRO: malformed free-text JSON never becomes an artifact — it fails closed', () => {
    const malformed = '{"claimedPositioning":{"value":"a "quoted" break","evidenceRefs":[]}';  // the position-3673 class
    expect(() => JSON.parse(malformed)).toThrow(SyntaxError);            // proves the fixture is genuinely malformed
    expect(() => artifactFromToolCall([{ type: 'text', text: malformed }])).toThrow(GenerationError);
  });
});
