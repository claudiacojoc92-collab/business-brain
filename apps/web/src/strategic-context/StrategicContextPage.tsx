import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  createContextItem, listContextItems, getEffectiveContext, getContextHistory, reviseContextItem, retireContextItem, ApiError,
  type StrategicContextItem, type EffectiveStrategicContext, type ContextKind, type ContextItemInput, type ContextScope,
} from '../api/client';
import { AppShell, Button } from '../system/ui';

/**
 * Wave 4 — Founder Strategic Context (/strategic-context). The founder explicitly records the conditions under which
 * their strategy must work — goals, constraints, resources, preferences, decision horizon. Append-only, temporal,
 * inspectable, revisable. NOTHING is inferred or saved without an explicit founder action. No personality language;
 * UNKNOWN is shown, never treated as zero. Session-guarded.
 */
const KINDS: Array<{ kind: ContextKind; title: string; blurb: string }> = [
  { kind: 'GOAL', title: 'Goals', blurb: 'What you’re trying to achieve.' },
  { kind: 'CONSTRAINT', title: 'Constraints', blurb: 'What currently limits how you can work.' },
  { kind: 'RESOURCE', title: 'Resources', blurb: 'What you currently have available.' },
  { kind: 'STRATEGIC_PREFERENCE', title: 'Preferences', blurb: 'Approaches you prefer (these inform, but don’t override, the evidence).' },
  { kind: 'DECISION_HORIZON', title: 'Decision horizon', blurb: 'The window a current recommendation must work within.' },
];
const SCOPES: ContextScope[] = ['GLOBAL_STRATEGY', 'CURRENT_PRIORITY', 'MARKETING', 'OFFER', 'ACQUISITION', 'POSITIONING', 'WEBSITE', 'LAUNCH', 'OTHER'];
const OPTS: Record<string, string[]> = {
  goalPriority: ['PRIMARY', 'SECONDARY', 'UNRANKED'],
  constraintCategory: ['BUDGET', 'TIME', 'TEAM', 'SKILL', 'GEOGRAPHY', 'LEGAL', 'CONTRACTUAL', 'CAPACITY', 'RUNWAY', 'SEASONALITY', 'OTHER'],
  founderClassification: ['NOT_YET_CLASSIFIED', 'NEGOTIABLE', 'NON_NEGOTIABLE'],
  temporaryOrStructural: ['UNKNOWN', 'TEMPORARY', 'STRUCTURAL'],
  severity: ['', 'LOW', 'MEDIUM', 'HIGH'],
  resourceCategory: ['BUDGET', 'TIME', 'TEAM', 'AUDIENCE', 'SKILL', 'CONTENT_ASSET', 'PARTNERSHIP', 'DISTRIBUTION', 'REPUTATION', 'TECHNOLOGY', 'OTHER'],
  availability: ['UNKNOWN', 'AVAILABLE', 'PARTIALLY_AVAILABLE', 'PLANNED'],
  prefCategory: ['ACQUISITION', 'BRAND', 'PRICING', 'DELIVERY', 'GROWTH_PACE', 'VISIBILITY', 'FUNDING', 'TEAM', 'MARKET', 'BUSINESS_MODEL', 'OTHER'],
  strength: ['PREFERENCE', 'STRONG_PREFERENCE', 'NON_NEGOTIABLE'],
  appliesTo: ['CURRENT_PRIORITY', 'GLOBAL_STRATEGY', 'MARKETING', 'OFFER', 'ACQUISITION', 'POSITIONING', 'WEBSITE', 'LAUNCH', 'OTHER'],
};

export function StrategicContextPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<StrategicContextItem[]>([]);
  const [effective, setEffective] = useState<EffectiveStrategicContext | null>(null);
  const [adding, setAdding] = useState<ContextKind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);      // logicalItemId being revised
  const [history, setHistory] = useState<Record<string, StrategicContextItem[]>>({});

  const on401 = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); }, [navigate]);
  const refresh = useCallback(async () => {
    try { setItems(await listContextItems()); setEffective(await getEffectiveContext()); } catch (e) { on401(e); }
  }, [on401]);
  useEffect(() => { if (founderId) void refresh(); }, [founderId, refresh]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const save = async (kind: ContextKind, input: ContextItemInput, logicalItemId?: string) => {
    try {
      if (logicalItemId) await reviseContextItem(logicalItemId, input);
      else await createContextItem({ ...input, kind });
      setAdding(null); setEditing(null); await refresh();
    } catch (e) { if (e instanceof ApiError && (e.status === 400 || e.status === 409)) throw e; on401(e); }
  };
  const retire = async (logicalItemId: string) => { try { await retireContextItem(logicalItemId); await refresh(); } catch (e) { on401(e); } };
  const openHistory = async (logicalItemId: string) => {
    if (history[logicalItemId]) { setHistory((h) => { const n = { ...h }; delete n[logicalItemId]; return n; }); return; }
    try { setHistory((h) => ({ ...h, [logicalItemId]: [] })); const v = await getContextHistory(logicalItemId); setHistory((h) => ({ ...h, [logicalItemId]: v })); } catch (e) { on401(e); }
  };

  const staleByLogical = new Map((effective?.staleItems ?? []).map((s) => [s.logicalItemId, s]));

  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/welcome')} style={backBtn}>Back</button>}>
      <div style={{ maxWidth: 720 }}>
        <p style={eyebrow}>Strategic context</p>
        <h1 style={h1}>The conditions your strategy must work within</h1>
        <p style={lede}>
          This context helps Business Brain recommend strategies that fit your actual goals, resources, and constraints.
          Nothing is inferred or saved without your confirmation. Leave anything you’re unsure of blank — <em>unknown</em> is
          treated as unknown, never as zero.
        </p>

        {effective && (effective.missingCriticalAreas.length > 0 || effective.conflicts.length > 0) && (
          <div style={{ ...card, borderColor: 'var(--gold)', marginBottom: 'var(--sp-5)' }}>
            {effective.conflicts.length > 0 && <>
              <p style={sectionLabel}>Tensions to be aware of</p>
              {effective.conflicts.map((c) => <p key={c.id} style={{ ...liText, margin: '0 0 6px' }}>{c.description} <span style={{ color: 'var(--ink-3)' }}>{c.strategicImpact}</span></p>)}
            </>}
            {effective.missingCriticalAreas.length > 0 && <p style={{ ...meta, marginTop: effective.conflicts.length ? 'var(--sp-3)' : 0 }}>Not yet recorded: {effective.missingCriticalAreas.map((m) => m.area.replace('_', ' ').toLowerCase()).join(', ')}. You can use Strategy without these — I’ll just mark them unknown.</p>}
          </div>
        )}

        {KINDS.map(({ kind, title, blurb }) => {
          const kindItems = items.filter((i) => i.kind === kind);
          return (
            <section key={kind} style={{ marginBottom: 'var(--sp-6)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div><span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)' }}>{title}</span> <span style={meta}>{blurb}</span></div>
                {adding !== kind && <button type="button" onClick={() => { setAdding(kind); setEditing(null); }} style={addBtn}>+ add</button>}
              </div>
              {adding === kind && <ItemForm kind={kind} onCancel={() => setAdding(null)} onSave={(input) => save(kind, input)} />}
              {kindItems.length === 0 && adding !== kind && <p style={{ ...meta, marginTop: 8 }}>None recorded yet — unknown.</p>}
              {kindItems.map((i) => {
                const stale = staleByLogical.get(i.logicalItemId);
                return (
                  <div key={i.id} style={{ ...card, marginTop: 'var(--sp-3)', padding: 'var(--sp-4)' }}>
                    {editing === i.logicalItemId
                      ? <ItemForm kind={kind} existing={i} onCancel={() => setEditing(null)} onSave={(input) => save(kind, input, i.logicalItemId)} />
                      : <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                          <span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)' }}>{i.statement}</span>
                          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                            <button type="button" onClick={() => { setEditing(i.logicalItemId); setAdding(null); }} style={linkBtn}>revise</button>
                            <button type="button" onClick={() => void retire(i.logicalItemId)} style={linkBtn}>retire</button>
                            <button type="button" onClick={() => void openHistory(i.logicalItemId)} style={linkBtn}>{history[i.logicalItemId] ? 'hide' : 'history'}</button>
                          </div>
                        </div>
                        <p style={{ ...meta, marginTop: 4 }}>{metaSummary(i)}{i.version > 1 ? ` · v${i.version} (revised)` : ''}</p>
                        <p style={meta}>{tempLabel(i)}{stale ? <span style={{ color: stale.reason === 'EXPIRED' ? 'var(--warn-ink)' : 'var(--gold)', marginLeft: 6 }}>· {stale.reason === 'EXPIRED' ? 'expired — needs review' : 'review due'}</span> : null}</p>
                        {history[i.logicalItemId] && history[i.logicalItemId]!.length > 0 && (
                          <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
                            {history[i.logicalItemId]!.map((v) => <p key={v.id} style={{ ...meta, margin: '0 0 4px' }}>v{v.version} · {v.status.toLowerCase()} · “{v.statement}”</p>)}
                          </div>
                        )}
                      </>}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}

function metaSummary(i: StrategicContextItem): string {
  const m = i.metadata as Record<string, unknown>;
  if (i.kind === 'GOAL') { const t = m['target'] as { value?: unknown; unit?: unknown } | undefined; return [`priority ${String(m['priority'] ?? 'UNRANKED').toLowerCase()}`, t?.value != null ? `target ${t.value}${t.unit ? ' ' + t.unit : ''}` : null].filter(Boolean).join(' · '); }
  if (i.kind === 'CONSTRAINT') return [String(m['category']).toLowerCase(), String(m['founderClassification']).replace(/_/g, ' ').toLowerCase(), String(m['temporaryOrStructural']).toLowerCase()].join(' · ');
  if (i.kind === 'RESOURCE') return [String(m['category']).toLowerCase(), m['quantity'] != null ? `${m['quantity']}${m['unit'] ? ' ' + m['unit'] : ''}` : null, String(m['availability']).replace(/_/g, ' ').toLowerCase(), String(m['evidenceStatus']).replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ');
  if (i.kind === 'STRATEGIC_PREFERENCE') return [String(m['category']).toLowerCase(), String(m['strength']).replace(/_/g, ' ').toLowerCase()].join(' · ');
  if (i.kind === 'DECISION_HORIZON') return [String(m['label'] ?? ''), `applies to ${String(m['appliesTo'] ?? '').replace(/_/g, ' ').toLowerCase()}`].filter(Boolean).join(' · ');
  return '';
}
function tempLabel(i: StrategicContextItem): string {
  const d = (v: string | null) => (v ? new Date(v).toLocaleDateString() : null);
  const parts = [`from ${d(i.effectiveFrom)}`];
  if (i.effectiveUntil) parts.push(`until ${d(i.effectiveUntil)}`); else parts.push('open-ended');
  if (i.reviewAt) parts.push(`review ${d(i.reviewAt)}`);
  return parts.join(' · ');
}

/** Kind-specific minimal form. Progressive: only a statement is required; metadata fields have safe defaults. */
function ItemForm({ kind, existing, onCancel, onSave }: { kind: ContextKind; existing?: StrategicContextItem; onCancel: () => void; onSave: (input: ContextItemInput) => Promise<void> }) {
  const em = (existing?.metadata ?? {}) as Record<string, unknown>;
  const [statement, setStatement] = useState(existing?.statement ?? '');
  const [scope, setScope] = useState<ContextScope>((existing?.scope as ContextScope) ?? 'GLOBAL_STRATEGY');
  const [meta, setMeta] = useState<Record<string, string>>(() => initialMeta(kind, em));
  const [until, setUntil] = useState(existing?.effectiveUntil ? existing.effectiveUntil.slice(0, 10) : '');
  const [review, setReview] = useState(existing?.reviewAt ? existing.reviewAt.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setMeta((m) => ({ ...m, [k]: v }));

  const submit = async () => {
    if (!statement.trim()) { setError('a statement is required'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ statement: statement.trim(), scope, metadata: buildMeta(kind, meta), effectiveUntil: until ? new Date(until).toISOString() : null, reviewAt: review ? new Date(review).toISOString() : null });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'could not save'); } finally { setSaving(false); }
  };

  return (
    <div style={{ ...card, marginTop: 'var(--sp-3)', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label style={lbl}>{kind === 'GOAL' ? 'What are you trying to achieve?' : kind === 'CONSTRAINT' ? 'What limits how you can work? (a condition, not a trait)' : kind === 'RESOURCE' ? 'What do you have available?' : kind === 'STRATEGIC_PREFERENCE' ? 'What approach do you prefer?' : 'What decision window are you deciding for?'}
        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} style={ta} placeholder={placeholderFor(kind)} />
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {metaFields(kind).map((f) => (
          <label key={f.key} style={{ ...lbl, flex: '1 1 140px' }}>{f.label}
            {f.options ? <select value={meta[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} style={inp}>{f.options.map((o) => <option key={o} value={o}>{o === '' ? '—' : o.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
              : <input value={meta[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} style={inp} placeholder={f.placeholder} />}
          </label>
        ))}
        <label style={{ ...lbl, flex: '1 1 140px' }}>Scope<select value={scope} onChange={(e) => setScope(e.target.value as ContextScope)} style={inp}>{SCOPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}</select></label>
        <label style={{ ...lbl, flex: '1 1 140px' }}>Expires (optional)<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={inp} /></label>
        <label style={{ ...lbl, flex: '1 1 140px' }}>Review on (optional)<input type="date" value={review} onChange={(e) => setReview(e.target.value)} style={inp} /></label>
      </div>
      {error && <p role="alert" style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--warn-ink)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" loading={saving} onClick={() => void submit()}>{existing ? 'Save revision' : 'Add'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function placeholderFor(k: ContextKind): string {
  return k === 'GOAL' ? 'e.g. Reach £5k MRR by the end of Q3' : k === 'CONSTRAINT' ? 'e.g. Available marketing time: 4 hours per week until September' : k === 'RESOURCE' ? 'e.g. A 1,200-person newsletter list' : k === 'STRATEGIC_PREFERENCE' ? 'e.g. I don’t want to use cold outreach during this launch' : 'e.g. The next 30 days, before the product launch';
}
function metaFields(k: ContextKind): Array<{ key: string; label: string; options?: string[]; placeholder?: string }> {
  if (k === 'GOAL') return [{ key: 'priority', label: 'Priority', options: OPTS['goalPriority'] }, { key: 'targetValue', label: 'Target (optional)', placeholder: 'e.g. 5000' }, { key: 'targetUnit', label: 'Unit (optional)', placeholder: 'e.g. MRR £' }, { key: 'endsAt', label: 'Goal by (optional)', placeholder: 'YYYY-MM-DD' }];
  if (k === 'CONSTRAINT') return [{ key: 'category', label: 'Category', options: OPTS['constraintCategory'] }, { key: 'founderClassification', label: 'Classification', options: OPTS['founderClassification'] }, { key: 'temporaryOrStructural', label: 'Temporary or structural', options: OPTS['temporaryOrStructural'] }, { key: 'severity', label: 'Severity (optional)', options: OPTS['severity'] }];
  if (k === 'RESOURCE') return [{ key: 'category', label: 'Category', options: OPTS['resourceCategory'] }, { key: 'quantity', label: 'Quantity (optional)', placeholder: 'e.g. 1200' }, { key: 'unit', label: 'Unit (optional)', placeholder: 'e.g. subscribers' }, { key: 'availability', label: 'Availability', options: OPTS['availability'] }];
  if (k === 'STRATEGIC_PREFERENCE') return [{ key: 'category', label: 'Category', options: OPTS['prefCategory'] }, { key: 'strength', label: 'Strength', options: OPTS['strength'] }, { key: 'rationale', label: 'Why (optional)', placeholder: 'optional context' }];
  return [{ key: 'label', label: 'Horizon label', placeholder: 'e.g. next 30 days' }, { key: 'appliesTo', label: 'Applies to', options: OPTS['appliesTo'] }, { key: 'endsAt', label: 'Ends (optional)', placeholder: 'YYYY-MM-DD' }];
}
function initialMeta(k: ContextKind, em: Record<string, unknown>): Record<string, string> {
  const g = (v: unknown) => (v == null ? '' : String(v));
  if (k === 'GOAL') { const t = em['target'] as { value?: unknown; unit?: unknown } | undefined; const h = em['horizon'] as { endsAt?: unknown } | undefined; return { priority: g(em['priority']) || 'UNRANKED', targetValue: g(t?.value), targetUnit: g(t?.unit), endsAt: h?.endsAt ? String(h.endsAt).slice(0, 10) : '' }; }
  if (k === 'CONSTRAINT') return { category: g(em['category']) || 'OTHER', founderClassification: g(em['founderClassification']) || 'NOT_YET_CLASSIFIED', temporaryOrStructural: g(em['temporaryOrStructural']) || 'UNKNOWN', severity: g(em['severity']) };
  if (k === 'RESOURCE') return { category: g(em['category']) || 'OTHER', quantity: g(em['quantity']), unit: g(em['unit']), availability: g(em['availability']) || 'UNKNOWN' };
  if (k === 'STRATEGIC_PREFERENCE') return { category: g(em['category']) || 'OTHER', strength: g(em['strength']) || 'PREFERENCE', rationale: g(em['rationale']) };
  return { label: g(em['label']), appliesTo: g(em['appliesTo']) || 'CURRENT_PRIORITY', endsAt: em['endsAt'] ? String(em['endsAt']).slice(0, 10) : '' };
}
function buildMeta(k: ContextKind, m: Record<string, string>): Record<string, unknown> {
  if (k === 'GOAL') return { priority: m['priority'] || 'UNRANKED', ...(m['targetValue'] ? { target: { value: m['targetValue'], ...(m['targetUnit'] ? { unit: m['targetUnit'] } : {}) } } : {}), ...(m['endsAt'] ? { horizon: { endsAt: new Date(m['endsAt']).toISOString() } } : {}) };
  if (k === 'CONSTRAINT') return { category: m['category'], founderClassification: m['founderClassification'], temporaryOrStructural: m['temporaryOrStructural'], ...(m['severity'] ? { severity: m['severity'] } : {}) };
  if (k === 'RESOURCE') return { category: m['category'], availability: m['availability'], ...(m['quantity'] ? { quantity: m['quantity'] } : {}), ...(m['unit'] ? { unit: m['unit'] } : {}) };
  if (k === 'STRATEGIC_PREFERENCE') return { category: m['category'], strength: m['strength'], ...(m['rationale'] ? { rationale: m['rationale'] } : {}) };
  return { label: m['label'] || 'horizon', appliesTo: m['appliesTo'] || 'CURRENT_PRIORITY', ...(m['endsAt'] ? { endsAt: new Date(m['endsAt']).toISOString() } : {}) };
}

const backBtn = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } as const;
const eyebrow = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' } as const;
const h1 = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 var(--sp-3)' } as const;
const lede = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-6)' } as const;
const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)' } as const;
const meta = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: 0 } as const;
const sectionLabel = { display: 'block', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)', margin: '0 0 var(--sp-2)' } as const;
const liText = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)' } as const;
const addBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gold)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' } as const;
const linkBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } as const;
const inp = { padding: '8px 10px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' as const };
const ta = { width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' as const };
