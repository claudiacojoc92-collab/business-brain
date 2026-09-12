/**
 * Derived action readiness (Slice 5). Readiness is NEVER stored on the immutable Action — it is computed
 * from immutable action facts + the append-only outcome ledger + prerequisite completion + material
 * availability + required founder decision + strategy currency. This distinguishes PLAN-TIME feasibility
 * (frozen on the action) from CURRENT readiness (a live projection).
 */
import type { Action, ActionReadiness, ActionStateEntry } from './contracts';

export interface ReadinessInputs {
  readonly strategyStale: boolean;
  readonly availableMaterial: ReadonlySet<string>; // material the strategy currently licenses
  readonly decisionNeeded: ReadonlySet<string>;    // actionIds that require a founder decision first
}

/** Latest terminal outcome per action from the append-only ledger (last write wins by order). */
export function latestOutcomes(ledger: readonly ActionStateEntry[]): Map<string, ActionStateEntry> {
  const m = new Map<string, ActionStateEntry>();
  for (const e of ledger) m.set(e.actionId, e); // ledger is appended in order; later overrides earlier
  return m;
}

// TEMPORARY MATERIAL-COMPATIBILITY BRIDGE (until typed material refs exist in Strategy). Deterministic only —
// NEVER an LLM guess. Normalize (lowercase, punctuation→space, drop ONE leading article, trim), then prefer
// exact normalized equality. Containment is allowed ONLY when the required phrase is substantial (≥3 tokens),
// so a short generic required string ("list") can never match an arbitrary longer material ("waitlist export").
const normMaterial = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^(?:a|an|the)\s+/, '').trim();
const MIN_CONTAINMENT_TOKENS = 3;
function materialAvailable(required: string, available: ReadonlySet<string>): boolean {
  const r = normMaterial(required);
  if (!r) return true;
  const rTokens = r.split(' ').filter(Boolean).length;
  for (const a of available) {
    const n = normMaterial(a);
    if (!n) continue;
    if (n === r) return true;                                                   // exact normalized equality
    if (rTokens >= MIN_CONTAINMENT_TOKENS && (` ${n} `).includes(` ${r} `)) return true;      // required ⊆ available
    if (n.split(' ').filter(Boolean).length >= MIN_CONTAINMENT_TOKENS && (` ${r} `).includes(` ${n} `)) return true; // available ⊆ required
  }
  return false;
}

export function deriveReadiness(action: Action, outcomes: Map<string, ActionStateEntry>, inputs: ReadinessInputs): ActionReadiness {
  const terminal = outcomes.get(action.actionId);
  if (terminal) return { actionId: action.actionId, readiness: terminal.outcome, blocker: null }; // done|deferred|skipped
  if (inputs.strategyStale) return { actionId: action.actionId, readiness: 'blocked', blocker: { kind: 'strategy_stale', detail: 'Your strategy changed — re-derive the plan before doing this.' } };
  const unmet = action.prerequisites.find((p) => outcomes.get(p)?.outcome !== 'done');
  if (unmet) return { actionId: action.actionId, readiness: 'blocked', blocker: { kind: 'prerequisite_unfinished', detail: `Do "${unmet}" first.`, ref: unmet } };
  const missing = action.requiredMaterial.find((m) => !materialAvailable(m, inputs.availableMaterial));
  if (missing) return { actionId: action.actionId, readiness: 'blocked', blocker: { kind: 'missing_material', detail: `Missing: ${missing}.`, material: missing } };
  if (inputs.decisionNeeded.has(action.actionId)) return { actionId: action.actionId, readiness: 'blocked', blocker: { kind: 'founder_decision', detail: 'Needs a decision from you first.' } };
  return { actionId: action.actionId, readiness: 'ready', blocker: null };
}

/** Readiness for every action in a plan. */
export function deriveAllReadiness(actions: readonly Action[], ledger: readonly ActionStateEntry[], inputs: ReadinessInputs): Map<string, ActionReadiness> {
  const outcomes = latestOutcomes(ledger);
  const out = new Map<string, ActionReadiness>();
  for (const a of actions) out.set(a.actionId, deriveReadiness(a, outcomes, inputs));
  return out;
}
