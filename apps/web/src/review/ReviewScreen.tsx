import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  approveContent,
  getCurrentBrief,
  getCurrentContent,
  rejectContent,
  type CycleBrief,
  type ContentPieceForApproval,
} from '../api/client';

interface ErrInfo { status: number; code: string }

function toErr(e: unknown): ErrInfo {
  if (e instanceof ApiError) return { status: e.status, code: e.code };
  return { status: 0, code: 'UNKNOWN_ERROR' };
}

const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0a0f1a', padding: '40px 20px', color: '#e8e6e1' };
const inner: React.CSSProperties = { maxWidth: 720, margin: '0 auto' };
const card: React.CSSProperties = { border: '1px solid #1f2937', borderRadius: 6, padding: 16, marginBottom: 16 };
const muted: React.CSSProperties = { color: '#6b7280' };
const btn: React.CSSProperties = { fontFamily: 'inherit', fontSize: '0.875rem', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', marginRight: 8 };

/** Maps a brief load error to a founder-facing message via existing API codes. */
function briefMessage(err: ErrInfo): string {
  switch (err.code) {
    case 'CYCLE_NOT_COMMITTED': return 'Your brief is being prepared and is not ready yet.';
    case 'CYCLE_NOT_FOUND':     return 'No review cycle yet — your first brief is on its way.';
    case 'BRIEF_NOT_FOUND':     return 'No brief is available for this cycle.';
    default:                    return 'We could not load your brief.';
  }
}

export function ReviewScreen() {
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<CycleBrief | null>(null);
  const [briefErr, setBriefErr] = useState<ErrInfo | null>(null);
  const [content, setContent] = useState<ContentPieceForApproval[]>([]);
  const [contentErr, setContentErr] = useState<ErrInfo | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    const [b, c] = await Promise.allSettled([getCurrentBrief(), getCurrentContent()]);
    if (b.status === 'fulfilled') { setBrief(b.value); setBriefErr(null); }
    else { setBrief(null); setBriefErr(toErr(b.reason)); }
    if (c.status === 'fulfilled') { setContent(c.value); setContentErr(null); }
    else { setContent([]); setContentErr(toErr(c.reason)); }
    setLoading(false);
  }, []);

  const refetchContent = useCallback(async () => {
    try { setContent(await getCurrentContent()); setContentErr(null); }
    catch (e) { setContentErr(toErr(e)); }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Approve/Reject: on success ALWAYS refetch the list (no local row mutation).
  const act = useCallback(
    async (id: string, fn: (id: string) => Promise<unknown>, verb: string) => {
      setActingId(id);
      setNotice(null);
      try {
        await fn(id);
        await refetchContent();
        // Honest success confirmation, only after the backend confirms (approve is this cycle's
        // deliberate write). Shown once the piece has left the pending list.
        if (verb === 'approve') {
          setNotice({ tone: 'ok', text: 'Approved — this piece is approved and no longer pending.' });
        }
      } catch (e) {
        if (toErr(e).status === 409) {
          setNotice({ tone: 'warn', text: 'That piece was already decided. The list has been refreshed.' });
          await refetchContent();
        } else {
          setNotice({ tone: 'warn', text: `We could not ${verb} that piece. Please try again.` });
        }
      } finally {
        setActingId(null);
      }
    },
    [refetchContent],
  );

  if (loading) {
    return <div style={wrap}><div style={inner}><span style={muted}>Loading…</span></div></div>;
  }

  return (
    <div style={wrap}>
      <div style={inner}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 500, marginBottom: 24 }}>This week&apos;s review</h1>

        {notice && (
          <div
            style={{ ...card, borderColor: notice.tone === 'ok' ? '#23402a' : '#3b3320', color: notice.tone === 'ok' ? '#9fd6ab' : '#d6c98a' }}
            role="status"
          >
            {notice.text}
          </div>
        )}

        {/* Brief panel (C1) */}
        {briefErr ? (
          <div style={card}><span style={muted}>{briefMessage(briefErr)}</span></div>
        ) : brief ? (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>{brief.mode}</strong>
              <span style={muted}>{brief.isFallback ? 'Fallback brief' : brief.validationResult}</span>
            </div>
            <p style={{ lineHeight: 1.6, marginBottom: 8 }}>{brief.strategicPurpose}</p>
            <div style={muted}>Audience: {brief.audienceSegment}</div>
            <div style={muted}>
              Confidence {Math.round(brief.briefConfidence * 100)}% · Uniqueness {brief.uniquenessScore}
            </div>
          </div>
        ) : null}

        {/* Content list (C3) */}
        <h2 style={{ fontSize: '1rem', fontWeight: 500, margin: '24px 0 12px' }}>Pending content</h2>

        {contentErr ? (
          <div style={card}>
            <span style={muted}>We could not load your content. </span>
            <button style={{ ...btn, background: 'none', border: '1px solid #1f2937', color: '#e8e6e1' }} onClick={() => void loadAll()}>Retry</button>
          </div>
        ) : content.length === 0 ? (
          <div style={card}><span style={muted}>No content is waiting for your review.</span></div>
        ) : (
          content.map((p) => (
            <div key={p.contentPieceId} style={card}>
              <div style={{ ...muted, marginBottom: 8 }}>
                {p.pieceType} · {p.pieceRole} · {p.approvalStatus}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: '0 0 12px' }}>
                {p.contentPreview ?? '(no preview)'}
              </pre>
              <button
                style={{ ...btn, background: '#1a2e1a', border: '1px solid #2f4f2f', color: '#cfe8cf' }}
                disabled={actingId === p.contentPieceId}
                onClick={() => void act(p.contentPieceId, approveContent, 'approve')}
              >
                Approve
              </button>
              <button
                style={{ ...btn, background: '#2e1a1a', border: '1px solid #4f2f2f', color: '#e8cfcf' }}
                disabled={actingId === p.contentPieceId}
                onClick={() => void act(p.contentPieceId, rejectContent, 'reject')}
              >
                Reject
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
