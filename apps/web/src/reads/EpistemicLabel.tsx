import type { EpistemicKind } from './types';
import { epistemicChip } from './styles';

/**
 * The epistemic status of a claim, as a WORD — differentiated by weight + case + structure, never by
 * color (accessible without color alone). It states what KIND of thing this is (observed / declared /
 * inferred read), NEVER a severity, urgency, or importance signal. The raw internal engine category is
 * never shown here — only the epistemic kind.
 */
const LABEL: Record<EpistemicKind, string> = {
  observed: 'Observed',
  declared: 'Declared',
  inferred: 'Inferred read',
};

export function EpistemicLabel({ kind }: { kind: EpistemicKind }) {
  return <span style={epistemicChip}>{LABEL[kind]}</span>;
}
