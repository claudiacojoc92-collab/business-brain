// ── The grounded BRIEFING (the Moment 4 opener) parsed into a SCANNABLE structure, not a wall of text. ──
// The model output must NOT change (same content, same words), so this is purely presentational: it parses the
// one-paragraph recap the model produced into a lead line, source-labelled sections with bullets, a "what I'm
// not sure about" section, and the closing invitation. If the expected "Label: …" structure isn't present the
// caller falls back to short lines (never one blob). Pure string logic — no React — so it is unit-testable and
// runnable standalone.
export type Briefing = {
  lead: string;
  sections: { label: string; points: string[] }[];
  notSure: { label: string; points: string[] } | null;
  invitation: string | null;
};

const NOT_SURE_RE = /(nu(-i)? (?:îmi )?(?:e|este|prea e) clar|nu (?:sunt|știu) sigur|ce nu (?:îmi )?e clar|not sure|not certain|unsure|non (?:mi )?è chiaro|non sono sicur)/i;

function splitPoints(body: string): string[] {
  const raw = body
    .split(/(?:(?<=\.)\s+|;\s+|\s+[—–]\s+)/) // sentences, semicolons, em/en-dash sub-points
    .map((s) => s.replace(/^[\s,;.—–-]+/, '').trim())
    .filter((s) => s.length > 1);
  // Merge tiny orphan fragments (an em-dash appositive like "— companii —") back into the previous bullet, so
  // every bullet is a real point, not a stray word.
  const out: string[] = [];
  for (const p of raw) {
    if (out.length && p.length < 16) out[out.length - 1] = `${out[out.length - 1]} — ${p}`;
    else out.push(p);
  }
  return out;
}

export function parseBriefing(text: string): Briefing {
  const raw = (text ?? '').trim();
  let body = raw;
  let invitation: string | null = null;
  // The invitation is the trailing question — kept as its own paragraph when the opener turn was assembled.
  const paras = raw.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (paras.length > 1 && paras[paras.length - 1].length <= 160 && /[?？]/.test(paras[paras.length - 1])) {
    invitation = paras[paras.length - 1];
    body = paras.slice(0, -1).join(' ').trim();
  } else {
    const m = body.match(/([^.?!]*\?)\s*$/); // else pull a short trailing question sentence, if any
    if (m && m[1] && m[1].trim().length <= 160) { invitation = m[1].trim(); body = body.slice(0, m.index).trim(); }
  }
  // Find "Label: …" section starts — a short phrase ending in ':' at the start or after a sentence boundary.
  const matches = [...body.matchAll(/(^|[.?]\s+)([^.?:\n]{3,70}?):\s/g)];
  const sections: { label: string; points: string[] }[] = [];
  let notSure: { label: string; points: string[] } | null = null;
  const lead = (matches.length ? body.slice(0, (matches[0].index ?? 0) + matches[0][1].length) : body).trim();
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const label = m[2].trim().replace(/\s+/g, ' ');
    const bodyStart = (m.index ?? 0) + m[1].length + m[2].length + 1; // past "<sep><label>:"
    const end = i + 1 < matches.length ? matches[i + 1].index ?? body.length : body.length;
    const points = splitPoints(body.slice(bodyStart, end).trim());
    if (!label || !points.length) continue;
    if (NOT_SURE_RE.test(label) && !notSure) notSure = { label, points };
    else sections.push({ label, points });
  }
  return { lead, sections, notSure, invitation };
}
