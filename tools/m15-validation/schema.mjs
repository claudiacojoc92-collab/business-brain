/**
 * M1.5 output contract (zod) + validation that enforces the trust rules.
 * The evidence-chain requirement and the "cited source must be a provided source" rule
 * are the biggest trust risks — enforced here, not left to prose.
 */
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const EvidenceItem = z.object({
  source: nonEmpty,
  quote: nonEmpty,
  why: nonEmpty,
});

// Structural schema for one insight. evidenceChain.min(1) is the hard requirement.
export const InsightSchema = z.object({
  synthesis: nonEmpty,
  evidenceChain: z.array(EvidenceItem).min(1),
  confidenceKind: z.enum(['observed', 'inferred']),
}).strip();

export const ObservationSchema = z.object({
  text: nonEmpty,
  source: nonEmpty,
  quote: nonEmpty,
  confidenceKind: z.literal('observed'),
}).strip();

export const HypothesisSchema = z.object({
  text: nonEmpty,
  confidenceKind: z.literal('inferred'),
}).strip();

// Top level is parsed leniently (arrays of unknown) so ONE bad item doesn't sink the run;
// each item is validated individually and invalid ones are EXCLUDED + logged as findings.
export const RawOutputSchema = z.object({
  insights: z.array(z.unknown()).default([]),
  observations: z.array(z.unknown()).default([]),
  hypotheses: z.array(z.unknown()).default([]),
});

/**
 * Validate the model output against the contract + the provided source set.
 * Returns kept items and excluded items (with reasons) — exclusions are findings.
 */
export function validateOutput(raw, providedSources) {
  const provided = new Set(providedSources.map((s) => s.toLowerCase()));
  const inProvided = (s) => provided.has(String(s).toLowerCase());

  const insights = [];
  const excludedInsights = [];
  raw.insights.forEach((item, i) => {
    const parsed = InsightSchema.safeParse(item);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ');
      excludedInsights.push({ index: i, item, reason: `schema invalid — ${reason}` });
      return;
    }
    // Provided-source enforcement (prevents fabricated provenance — the M1 bug, engine-side).
    const bad = parsed.data.evidenceChain.filter((e) => !inProvided(e.source));
    if (bad.length > 0) {
      const names = [...new Set(bad.map((e) => e.source))].join(', ');
      excludedInsights.push({ index: i, item, reason: `cites source(s) not in the input set: ${names}` });
      return;
    }
    insights.push(parsed.data);
  });

  const observations = [];
  const excludedObservations = [];
  raw.observations.forEach((item, i) => {
    const parsed = ObservationSchema.safeParse(item);
    if (!parsed.success) {
      excludedObservations.push({ index: i, item, reason: 'schema invalid (needs text + source + quote + observed)' });
      return;
    }
    if (!inProvided(parsed.data.source)) {
      excludedObservations.push({ index: i, item, reason: `cites source not in the input set: ${parsed.data.source}` });
      return;
    }
    observations.push(parsed.data);
  });

  const hypotheses = [];
  const excludedHypotheses = [];
  raw.hypotheses.forEach((item, i) => {
    const parsed = HypothesisSchema.safeParse(item);
    if (parsed.success) hypotheses.push(parsed.data);
    else excludedHypotheses.push({ index: i, item, reason: 'schema invalid (needs text + inferred, no source)' });
  });

  return { insights, excludedInsights, observations, excludedObservations, hypotheses, excludedHypotheses };
}
