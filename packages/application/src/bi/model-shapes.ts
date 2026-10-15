import type { GovernedUnderstanding } from './contracts';

/**
 * MODEL LIST SHAPES (2026-10-15, prod bug "(xs ?? []).map is not a function"). A model sometimes returns a list field as
 * a lone string (stage.secondary.evidence = "…"). Every model-generated list in the understanding is normalised with one
 * rule, at the governance boundary (before storage) AND at read time (for snapshots already stored):
 *   array → kept (string lists keep only non-empty strings) · lone non-empty string → [string] · anything else → [].
 * Deterministic, generic, no business vocabulary.
 */
export function stringList(x: unknown): string[] {
  if (Array.isArray(x)) return x.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  if (typeof x === 'string') return x.trim() ? [x.trim()] : [];
  return [];
}

/** A list of objects: kept when it is an array (non-objects dropped), else []. A lone object is not a list. */
export function objectList<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x.filter((v) => v !== null && typeof v === 'object') as T[]) : [];
}

const obj = <T extends object>(x: unknown): T | undefined => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as T) : undefined);

/** The understanding with every model-generated list in its proper shape (pure; never throws on a malformed field). */
export function normalizeUnderstandingShapes(u: GovernedUnderstanding): GovernedUnderstanding {
  if (!u || typeof u !== 'object') return u;
  const offer = obj<GovernedUnderstanding['offer']>(u.offer);
  const positioning = obj<GovernedUnderstanding['positioning']>(u.positioning);
  const audience = obj<GovernedUnderstanding['audience']>(u.audience);
  const messaging = obj<GovernedUnderstanding['messaging']>(u.messaging);
  const acquisition = obj<GovernedUnderstanding['acquisition']>(u.acquisition);
  const cc = obj<NonNullable<GovernedUnderstanding['capabilityCheck']>>(u.capabilityCheck);
  const constraint = obj<NonNullable<GovernedUnderstanding['constraint']>>(u.constraint);
  const stage = obj<NonNullable<GovernedUnderstanding['stage']>>(u.stage);
  const secondary = stage ? obj<NonNullable<NonNullable<GovernedUnderstanding['stage']>['secondary']>>(stage.secondary) : undefined;
  const read = obj<NonNullable<GovernedUnderstanding['read']>>(u.read);
  const evidenceList = (x: unknown) => objectList<{ ref: string; quote: string; page?: string }>(x);
  return {
    ...u,
    offer: { ...(offer ?? { summary: '' }), summary: typeof offer?.summary === 'string' ? offer.summary : '', explicit: stringList(offer?.explicit), unclear: stringList(offer?.unclear), sourceRefs: stringList(offer?.sourceRefs) },
    positioning: { ...(positioning ?? { summary: '' }), summary: typeof positioning?.summary === 'string' ? positioning.summary : '', evidenceBacked: stringList(positioning?.evidenceBacked), implied: stringList(positioning?.implied), sourceRefs: stringList(positioning?.sourceRefs) },
    audience: { ...(audience ?? {}), addressed: stringList(audience?.addressed), appearsTargeted: stringList(audience?.appearsTargeted), unknown: stringList(audience?.unknown), sourceRefs: stringList(audience?.sourceRefs) },
    messaging: { ...(messaging ?? {}), recurringThemes: stringList(messaging?.recurringThemes), sourceRefs: stringList(messaging?.sourceRefs) },
    acquisition: { ...(acquisition ?? {}), visiblePaths: stringList(acquisition?.visiblePaths), sourceRefs: stringList(acquisition?.sourceRefs) },
    contradictions: objectList<GovernedUnderstanding['contradictions'][number]>(u.contradictions)
      .map((c) => ({ ...c, sourceRefs: stringList(c.sourceRefs), ...(c.evidence !== undefined ? { evidence: evidenceList(c.evidence) } : {}) })),
    unknowns: stringList(u.unknowns),
    ...(cc ? { capabilityCheck: { ...cc, sourceRefs: stringList(cc.sourceRefs), ...(cc.evidence !== undefined ? { evidence: evidenceList(cc.evidence) } : {}) } } : {}),
    ...(constraint ? { constraint: { ...constraint, sourceRefs: stringList(constraint.sourceRefs) } } : {}),
    ...(stage ? { stage: {
      ...stage, evidence: stringList(stage.evidence), sourceRefs: stringList(stage.sourceRefs),
      secondary: secondary ? { ...secondary, evidence: stringList(secondary.evidence) } : (stage.secondary === undefined ? undefined : null),
    } } : {}),
    ...(read ? { read: {
      ...read,
      model: objectList<NonNullable<GovernedUnderstanding['read']>['model'][number]>(read.model).map((d) => ({
        ...d, known: objectList<NonNullable<GovernedUnderstanding['read']>['model'][number]['known'][number]>(d.known).map((k) => ({ ...k, sourceRefs: stringList(k.sourceRefs) })), unknown: stringList(d.unknown),
      })),
      notConcluding: objectList(read.notConcluding),
      untrusted: objectList<NonNullable<GovernedUnderstanding['read']>['untrusted'][number]>(read.untrusted).map((x) => ({ ...x, refs: stringList(x.refs) })),
      websiteNotes: stringList(read.websiteNotes),
      questions: objectList<NonNullable<GovernedUnderstanding['read']>['questions'][number]>(read.questions).map((q) => ({
        ...q, changes: stringList(q.changes) as typeof q.changes, ...(q.parts !== undefined ? { parts: stringList(q.parts) } : {}), ...(q.fills !== undefined ? { fills: stringList(q.fills) as NonNullable<typeof q.fills> } : {}),
      })),
      diagnosis: { ...(obj<NonNullable<GovernedUnderstanding['read']>['diagnosis']>(read.diagnosis) ?? { state: 'not_ready', statement: '', checks: {} }), sourceRefs: stringList(obj<{ sourceRefs?: unknown }>(read.diagnosis)?.sourceRefs) },
      ...(read.observations !== undefined ? { observations: objectList(read.observations) } : {}),
    } } : {}),
  };
}
