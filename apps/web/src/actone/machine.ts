/**
 * Act I phase machine (§7). Linear, single-direction flow; phase changes append/reveal
 * scene blocks in one continuous scroll (no router transitions inside Act I).
 *
 * contact → connect → analyzing → seeing → seeing_verdict → conversation →
 * absorbing → gift → gift_reacted → week → complete
 */
import type { Phase, RailFacet } from './types';

export const PHASE_ORDER: readonly Phase[] = [
  'contact',
  'connect',
  'analyzing',
  'seeing',
  'seeing_verdict',
  'conversation',
  'absorbing',
  'gift',
  'gift_reacted',
  'week',
  'complete',
];

export function nextPhase(phase: Phase): Phase {
  const i = PHASE_ORDER.indexOf(phase);
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : phase;
}

export function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

/**
 * Rail state for a given phase (§4).
 * Facet "done" boundaries:
 *   business → done once we leave seeing_verdict (entering conversation)
 *   thinking → done once we leave conversation (entering absorbing/gift)
 *   voice    → done once we leave gift_reacted (entering week)
 *   rhythm   → done at complete
 */
const ALL: RailFacet[] = ['business', 'thinking', 'voice', 'rhythm'];

export function railFor(phase: Phase): { active: RailFacet | null; done: RailFacet[] } {
  const idx = phaseIndex(phase);
  const after = (p: Phase) => idx > phaseIndex(p); // strictly past p → that facet's work is finished

  const done: RailFacet[] = [];
  if (after('seeing_verdict')) done.push('business');
  if (after('conversation')) done.push('thinking');
  if (after('gift_reacted')) done.push('voice');
  if (phase === 'complete') done.push('rhythm');

  let active: RailFacet | null;
  if (phase === 'complete') active = null;
  else if (idx <= phaseIndex('seeing_verdict')) active = 'business';
  else if (idx <= phaseIndex('conversation')) active = 'thinking';
  else if (idx <= phaseIndex('gift_reacted')) active = 'voice';
  else active = 'rhythm';

  return { active, done: ALL.filter((f) => done.includes(f)) };
}
