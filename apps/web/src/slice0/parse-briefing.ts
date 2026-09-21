// The Moment 4 opener is now STRUCTURED (the model emits it; the service stores it as a JSON turn tagged with
// ARC_OPENER_MARKER). No prose regex parsing any more — the UI just detects the JSON opener turn and renders its
// fields. A normal (prose) turn returns null here and renders as plain text.
export type ArcOpener = { lead: string; bullets: string[]; notSure: string | null; invitation: string };

const ARC_OPENER_MARKER = '__arcOpener'; // must match the constant in @bb/application conversation.service

export function parseOpenerTurn(content: string): ArcOpener | null {
  const s = (content ?? '').trim();
  if (!s.startsWith('{') || !s.includes(ARC_OPENER_MARKER)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = (JSON.parse(s) as any)?.[ARC_OPENER_MARKER];
    if (!o || typeof o !== 'object') return null;
    const lead = String(o.lead ?? '').trim();
    const invitation = String(o.invitation ?? '').trim();
    if (!lead || !invitation) return null;
    return {
      lead,
      bullets: (Array.isArray(o.bullets) ? o.bullets : []).map((b: unknown) => String(b ?? '').trim()).filter(Boolean).slice(0, 3),
      notSure: o.notSure ? String(o.notSure).trim() : null,
      invitation,
    };
  } catch {
    return null;
  }
}
