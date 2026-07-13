import type { BusinessRead, ReadClaim, ReadSection as ReadSectionData, SourceManifestEntry, Limit } from './types';
import { SECTION_ORDER, isRecommendationClaim } from './types';
import { SECTION_TITLES, EMPTY_COPY, absentSourceLine } from './copy';
import { ReadSection } from './ReadSection';
import { EpistemicLabel } from './EpistemicLabel';
import { EvidenceReceipt } from './EvidenceReceipt';
import { ReceiptDisclosure } from './ReceiptDisclosure';
import { GapView } from './GapView';
import { RecommendationView } from './RecommendationView';
import { EmptySectionState } from './EmptySectionState';
import { claimText, meta } from './styles';

/**
 * The Business Read as one continuous vertical document — the six sections in FIXED order, top to bottom.
 * It never reorders, never ranks, never directs attention. The Read ENDS on S6 (disclosed blindness) — no
 * CTA follows. Everything grounded is passed through verbatim; the surface adds only structure + labels.
 */
const SOURCE_NAME: Record<string, string> = { website: 'Website', upload: 'Uploads', google: 'Google', 'google-calendar': 'Calendar' };
const dateRange = (m: SourceManifestEntry): string => {
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const a = fmt(m.earliest); const b = fmt(m.latest);
  return a && b ? (a === b ? a : `${a} – ${b}`) : a || b;
};

function SectionBody({ section }: { section: ReadSectionData }) {
  const claims = section.claims ?? [];
  switch (section.id) {
    case 'what_i_read': {
      const manifest = section.manifest ?? [];
      if (manifest.length === 0) return <EmptySectionState copy={EMPTY_COPY.what_i_read!} />;
      return (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {manifest.map((m) => {
            const range = dateRange(m);
            return (
              <li key={m.source} style={{ ...meta, fontSize: '0.9rem', color: 'var(--ink-2)', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                {SOURCE_NAME[m.source] ?? m.source} · {m.itemCount} {m.itemCount === 1 ? 'item' : 'items'}{range ? ` · ${range}` : ''}
              </li>
            );
          })}
        </ul>
      );
    }
    case 'what_i_observe': {
      if (claims.length === 0) return <EmptySectionState copy={EMPTY_COPY.what_i_observe!} />;
      return (
        <>
          {claims.map((c, i) => (
            <div key={i} style={{ margin: '0 0 24px' }}>
              <p style={claimText}>{c.statement}</p>
              <EpistemicLabel kind={c.epistemicKind} />
              {(c.receipts?.length ?? 0) > 0 && (
                <ReceiptDisclosure label="What this rests on">
                  {c.receipts!.map((r) => <EvidenceReceipt key={r.fragmentId} receipt={r} />)}
                </ReceiptDisclosure>
              )}
            </div>
          ))}
        </>
      );
    }
    case 'gaps': {
      if (claims.length === 0) return <EmptySectionState copy={EMPTY_COPY.gaps!} />;
      return <>{(claims as ReadClaim[]).map((c, i) => <GapView key={i} claim={c} />)}</>;
    }
    case 'bets':
      // INTENTIONALLY EMPTY (Sprint 1) — the principle of a bet, no pressure to create content.
      return <EmptySectionState copy={EMPTY_COPY.bets!} />;
    case 'my_read': {
      const recs = claims.filter(isRecommendationClaim);
      if (recs.length === 0) return <EmptySectionState copy={EMPTY_COPY.my_read!} />;
      return <>{recs.map((c, i) => <RecommendationView key={i} claim={c} />)}</>;
    }
    case 'cannot_see': {
      const limits = section.limits ?? [];
      if (limits.length === 0) return null;
      return (
        <>
          {limits.map((l: Limit, i) => (
            <p key={i} style={{ ...meta, fontSize: '0.95rem', color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 12px' }}>
              {l.kind === 'absent_source' ? absentSourceLine(l.source) : l.detail}
            </p>
          ))}
        </>
      );
    }
    default:
      return null;
  }
}

export function ReadDocument({ read }: { read: BusinessRead }) {
  const byId = new Map(read.sections.map((s) => [s.id, s]));
  const generated = new Date(read.assembledAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <article style={{ fontFamily: 'var(--serif)' }}>
      <header style={{ margin: '0 0 44px' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.9rem', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 6px' }}>Business Read</h1>
        <p style={{ ...meta }}>Generated {generated}</p>
      </header>
      {SECTION_ORDER.map((id) => {
        const section = byId.get(id);
        if (!section) return null; // defensive — the assembler always emits all six
        return (
          <ReadSection key={id} title={SECTION_TITLES[id]}>
            <SectionBody section={section} />
          </ReadSection>
        );
      })}
    </article>
  );
}
