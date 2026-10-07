import { ValidationError, NotFoundError } from '@bb/shared';
import type { IReachReportRepository, ReachReport, ReachReportInput, ReachReportPatch } from './contracts';

const MAX_TEXT = 2000;
const MAX_HINT = 80;
const MAX_COUNT = 100_000;

/** Floor a reported count into a sane non-negative integer, or null when it is absent / not a real number. */
function normalizeCount(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), MAX_COUNT);
}

function clipHint(h: string | null | undefined): string | null {
  const s = (h ?? '').trim();
  return s ? s.slice(0, MAX_HINT) : null;
}

/**
 * Attribution-by-asking service. Stores and reflects the founder's own weekly reach reports; it never
 * synthesizes, attributes, or asserts anything — the surface that shows these back to the founder shows
 * their verbatim words. Reflective-only (see the HARD WALL note in contracts.ts).
 *
 * IMPACT WIRING (intentionally NOT built yet). First-month attribution data cannot meaningfully move a
 * strategy, and the impact evaluator was just stabilised — so this stays unwired. When it is time, the
 * connection is a thin call and needs no schema change:
 *   const text = (await reachService.list(bid)).slice(0, 4)
 *     .map((r) => `Week of ${r.weekStart}: ${r.newPeopleCount ?? '?'} new — ${r.rawText}`).join('\n');
 *   await impactService.evaluate(bid, { source: 'outcome_report', newInput: text, ... });
 * i.e. the founder's verbatim report flows in through the EXISTING `outcome_report` ImpactSource — never as a
 * licensed proposition, never into asset generation. `publishedRefs` + the week window are already captured so
 * the evaluator can relate what was reported to what was published, without any new table.
 */
export class ReachService {
  constructor(private readonly deps: { repo: IReachReportRepository }) {}

  async record(input: ReachReportInput): Promise<ReachReport> {
    const rawText = (input.rawText ?? '').trim();
    if (!rawText) throw new ValidationError('REACH_TEXT_REQUIRED', 'Tell me how the new people heard about you.');
    if (rawText.length > MAX_TEXT) throw new ValidationError('REACH_TEXT_TOO_LONG', 'That is too long.');
    return this.deps.repo.create({
      ...input,
      rawText,
      newPeopleCount: normalizeCount(input.newPeopleCount),
      channelHint: clipHint(input.channelHint),
      publishedRefs: input.publishedRefs ?? [],
    });
  }

  list(businessId: string): Promise<ReachReport[]> {
    return this.deps.repo.list(businessId);
  }

  async correct(businessId: string, id: string, patch: ReachReportPatch): Promise<ReachReport> {
    const next: { rawText?: string; newPeopleCount?: number | null; channelHint?: string | null } = {};
    if (patch.rawText !== undefined) {
      const rawText = (patch.rawText ?? '').trim();
      if (!rawText) throw new ValidationError('REACH_TEXT_REQUIRED', 'Tell me how the new people heard about you.');
      if (rawText.length > MAX_TEXT) throw new ValidationError('REACH_TEXT_TOO_LONG', 'That is too long.');
      next.rawText = rawText;
    }
    if (patch.newPeopleCount !== undefined) next.newPeopleCount = normalizeCount(patch.newPeopleCount);
    if (patch.channelHint !== undefined) next.channelHint = clipHint(patch.channelHint);
    const updated = await this.deps.repo.update(businessId, id, next);
    if (!updated) throw new NotFoundError('REACH_REPORT_NOT_FOUND', 'That entry was not found.');
    return updated;
  }

  async remove(businessId: string, id: string): Promise<void> {
    const ok = await this.deps.repo.delete(businessId, id);
    if (!ok) throw new NotFoundError('REACH_REPORT_NOT_FOUND', 'That entry was not found.');
  }
}
