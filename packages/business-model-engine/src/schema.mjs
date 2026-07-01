/**
 * M1.5 Business Model artifact — output contract (zod) + validation that enforces the
 * trust rules. Registers (CLAIM / BELIEF / BEHAVIOR / MARKET RESPONSE) are observed facts;
 * relational insights are the product (inferred). Every field/insight must be grounded in
 * evidence from a PROVIDED source, or it is omitted and logged as a finding.
 */
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

// A provided source counts as "declared" (founder speaking) if its label looks spoken.
// (Input contract stays {source, content}; declared-ness is inferred from the label.)
export const DECLARED_PATTERN = /transcript|conversation|interview|podcast|\bcall\b|spoken|webinar|\btalk\b|\bama\b|q&a/i;

export const EvidenceRefSchema = z.object({ source: nonEmpty, fragment: nonEmpty }).strip();

export const FieldSchema = z.object({
  value: nonEmpty,
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  confidenceKind: z.enum(['observed', 'declared']),
}).strip();

export const InsightSchema = z.object({
  statement: nonEmpty,
  contributingFields: z.array(nonEmpty).min(1),
  evidenceChain: z.array(EvidenceRefSchema).min(1),
  confidenceKind: z.literal('inferred'),
}).strip();

export const ContextItemSchema = z.object({
  statement: nonEmpty,
  contextKind: z.enum(['market-pattern', 'category-signal', 'industry-benchmark']),
  confidenceKind: z.literal('i-know'),
}).strip();

export const SINGLE_FIELDS = [
  'claimedPositioning', 'claimedOffer', 'founderClaimedIdentity',
  'observedPositioning', 'audiencePerception', 'whatMarketRewards', 'audienceLanguage',
];
export const ARRAY_FIELDS = ['coreBeliefs', 'recurringThemes']; // coreBeliefs requires a declared source
export const INSIGHT_FIELDS = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

function checkField(raw, { providedSet, declaredSet, requireDeclared }) {
  const p = FieldSchema.safeParse(raw);
  if (!p.success) {
    return { ok: false, reason: `schema invalid — ${p.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ')}` };
  }
  const srcs = p.data.evidenceRefs.map((r) => r.source.toLowerCase());
  const notProvided = srcs.filter((s) => !providedSet.has(s));
  if (notProvided.length) return { ok: false, reason: `cites source not in input set: ${[...new Set(notProvided)].join(', ')}` };

  const needsDeclared = requireDeclared || p.data.confidenceKind === 'declared';
  if (needsDeclared) {
    if (declaredSet.size === 0) return { ok: false, reason: 'requires a declared/spoken source, but none was provided' };
    const nonDeclared = srcs.filter((s) => !declaredSet.has(s));
    if (nonDeclared.length) return { ok: false, reason: `must be grounded in a declared/spoken source; cites: ${[...new Set(nonDeclared)].join(', ')}` };
  }
  return { ok: true, field: p.data };
}

function checkInsight(raw, { providedSet }) {
  const p = InsightSchema.safeParse(raw);
  if (!p.success) {
    return { ok: false, reason: `schema invalid — ${p.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ')}` };
  }
  const bad = p.data.evidenceChain.map((r) => r.source.toLowerCase()).filter((s) => !providedSet.has(s));
  if (bad.length) return { ok: false, reason: `cites source not in input set: ${[...new Set(bad)].join(', ')}` };
  return { ok: true, insight: p.data };
}

/**
 * Validate the model output. Returns the kept model (invalid fields OMITTED) plus a list
 * of excluded findings. Nothing invalid is silently dropped.
 */
export function validateModel(raw, providedSources) {
  const providedSet = new Set(providedSources.map((s) => s.toLowerCase()));
  const declaredSet = new Set(providedSources.filter((s) => DECLARED_PATTERN.test(s)).map((s) => s.toLowerCase()));

  const model = {
    coreBeliefs: [], recurringThemes: [],
    contradictions: [], blindSpots: [], hiddenStrengths: [], hiddenWeaknesses: [], positioningOpportunities: [],
    marketContext: [],
    modelConfidence: typeof raw.modelConfidence === 'string' ? raw.modelConfidence : '(not reported)',
  };
  const excluded = [];

  for (const key of SINGLE_FIELDS) {
    if (raw[key] == null) continue; // absent → register unpopulated (honest degradation)
    const r = checkField(raw[key], { providedSet, declaredSet, requireDeclared: false });
    if (r.ok) model[key] = r.field;
    else excluded.push({ kind: `field:${key}`, label: raw[key]?.value ?? JSON.stringify(raw[key]).slice(0, 60), reason: r.reason });
  }

  for (const key of ARRAY_FIELDS) {
    const arr = Array.isArray(raw[key]) ? raw[key] : [];
    arr.forEach((item, i) => {
      const r = checkField(item, { providedSet, declaredSet, requireDeclared: key === 'coreBeliefs' });
      if (r.ok) model[key].push(r.field);
      else excluded.push({ kind: `field:${key}[${i}]`, label: item?.value ?? JSON.stringify(item).slice(0, 60), reason: r.reason });
    });
  }

  for (const key of INSIGHT_FIELDS) {
    const arr = Array.isArray(raw[key]) ? raw[key] : [];
    arr.forEach((item, i) => {
      const r = checkInsight(item, { providedSet });
      if (r.ok) model[key].push(r.insight);
      else excluded.push({ kind: `insight:${key}[${i}]`, label: item?.statement ?? JSON.stringify(item).slice(0, 60), reason: r.reason });
    });
  }

  const ctx = Array.isArray(raw.marketContext) ? raw.marketContext : [];
  ctx.forEach((item, i) => {
    // Market knowledge must NOT be attributed to a founder source.
    if (item && (item.source || item.evidenceRefs || item.evidenceChain || item.fragment)) {
      excluded.push({ kind: `marketContext[${i}]`, label: item?.statement ?? '(item)', reason: 'market context must not cite a founder source (it is prior knowledge)' });
      return;
    }
    const p = ContextItemSchema.safeParse(item);
    if (p.success) model.marketContext.push(p.data);
    else excluded.push({ kind: `marketContext[${i}]`, label: item?.statement ?? JSON.stringify(item).slice(0, 60), reason: 'schema invalid (needs statement + contextKind + i-know, no source)' });
  });

  return { model, excluded, declaredSources: [...declaredSet] };
}
