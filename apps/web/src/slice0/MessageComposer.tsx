import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import {
  addWriting, confirmSender, correctRelevance, draftMessage, getResults, logTouch, markMessageSent, updateContact,
  type CommunicationBriefView, type DraftView, type SenderIdentityView, type WritingRuleView,
} from '../api/client';

type Tr = (k: string, v?: Record<string, string>) => string;

/**
 * Result Loop V1 — the founder's message to ONE contact. BB builds a brief from real state, writes, checks that she
 * would actually send it (repairing at most twice), and otherwise says why it couldn't instead of showing a bad draft.
 * She sends it herself (copy / her email app) and says "I sent it": that is the execution write-back.
 */
export function MessageComposer(props: { businessId: string; contactId: string; contactName: string; onClose: () => void; onSent?: () => void }) {
  const { businessId, contactId, contactName, onClose } = props;
  const { t } = useLocale() as { t: Tr };
  const [sender, setSender] = useState<SenderIdentityView | null | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<SenderIdentityView | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  const [answer, setAnswer] = useState('');
  const [name, setName] = useState('');

  const write = useCallback(async () => {
    setBusy(true); setError(false);
    try {
      const d = await draftMessage(businessId, contactId);
      setDraft(d);
      if (d.status === 'ready') { setSubject(d.message.subject ?? ''); setBody(d.message.body); }
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, contactId]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await getResults(businessId);
        setSender(r.sender); setSuggestion(r.senderSuggestion);
        if (r.sender) await write();
      } catch { setError(true); }
    })();
  }, [businessId, write]);

  async function saveSender(s: SenderIdentityView) {
    setBusy(true);
    try { const r = await confirmSender(businessId, s); setSender(r.sender); await write(); } catch { setError(true); } finally { setBusy(false); }
  }
  async function iSentIt() {
    if (draft?.status !== 'ready') return;
    setBusy(true);
    try {
      await markMessageSent(businessId, contactId, { messageId: draft.messageId, subject: subject || null, body, draftBody: draft.message.body, channel: draft.brief.channel });
      setSent(true); props.onSent?.();
    } catch { setError(true); } finally { setBusy(false); }
  }
  /** An answer to what BB needs (how she knows them, what they treat) becomes a NOTE on the contact, then BB writes again. */
  async function addContext() {
    if (!answer.trim()) return;
    setBusy(true);
    try { await logTouch(businessId, contactId, { channel: 'OTHER', type: 'NOTE', summary: answer.trim() }); setAnswer(''); await write(); }
    catch { setError(true); } finally { setBusy(false); }
  }
  /** Her correction of the message's focus (which of her services matter to this person): durable, then BB writes again. */
  async function saveFocus(parts: { offer_part: string; reason: string }[]) {
    setBusy(true);
    try { await correctRelevance(businessId, contactId, parts); await write(); } catch { setError(true); } finally { setBusy(false); }
  }
  async function nameContact() {
    if (!name.trim()) return;
    setBusy(true);
    try { await updateContact(businessId, contactId, { name: name.trim() }); setName(''); await write(); } catch { setError(true); } finally { setBusy(false); }
  }

  const to = draft && draft.status !== 'needs_input' ? draft.brief.recipient_identity : null;
  const mailto = to?.email ? `mailto:${to.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;

  return (
    <>
      <div className="s0-talk-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="s0-talk-drawer" role="dialog" aria-label={t('msg.title', { name: contactName })}>
        <div className="s0-talk-head">
          <span className="s0-talk-title">{t('msg.title', { name: contactName })}</span>
          <button type="button" className="s0-talk-x" onClick={onClose} aria-label={t('talk.close')}>✕</button>
        </div>
        <div className="s0-talk-scroll">
          {error ? <div className="s0-error" role="alert">{t('common.actionFailed')}</div> : null}
          {sent ? (
            <div className="s0-add-done"><p>{t('msg.sentDone', { name: contactName })}</p>
              <button type="button" className="s0-btn" onClick={onClose}>{t('verdict.dismiss')}</button></div>
          ) : sender === undefined ? (
            <p className="s0-talk-note">{t('today2.working')}</p>
          ) : sender === null ? (
            <SenderForm suggestion={suggestion} busy={busy} onSave={saveSender} t={t} />
          ) : busy && !draft ? (
            <p className="s0-talk-note">{t('msg.writing')}</p>
          ) : draft?.status === 'needs_input' ? (
            <div>
              {draft.problems.map((p, i) => <p key={i} className="s0-talk-note">{p.detail}</p>)}
              {draft.problems.some((p) => p.code === 'recipient_unnamed') ? (
                <div className="s0-today2-actions">
                  <input className="s0-blk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('msg.whoIsIt')} />
                  <button type="button" className="s0-btn" disabled={busy || !name.trim()} onClick={nameContact}>{t('msg.save')}</button>
                </div>
              ) : null}
            </div>
          ) : draft?.status === 'failed' ? (
            <div>
              <FocusEditor brief={draft.brief} busy={busy} onSave={saveFocus} t={t} />
              <p className="s0-today2-k">{t('msg.failedK')}</p>
              <p>{t('msg.failed')}</p>
              <ul className="s0-verdict-list">{draft.reasons.map((r, i) => <li key={i}>{r.detail}</li>)}</ul>
              {draft.clarify.length ? (<>
                <p className="s0-today2-k">{t('msg.clarifyK')}</p>
                <ul className="s0-verdict-list">{draft.clarify.map((c, i) => <li key={i}>{c}</li>)}</ul>
                <textarea className="s0-blk-input" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t('msg.answerPh')} />
                <div className="s0-today2-actions">
                  <button type="button" className="s0-btn" disabled={busy || !answer.trim()} onClick={addContext}>{busy ? t('today2.working') : t('msg.tryAgain')}</button>
                </div>
              </>) : null}
            </div>
          ) : draft?.status === 'ready' ? (
            <div>
              <dl className="s0-msg-brief">
                <dt>{t('msg.to')}</dt><dd>{[to?.name, draft.brief.recipient_role, to?.organisation].filter(Boolean).join(' · ')}{to?.email ? ` <${to.email}>` : ''}</dd>
                <dt>{t('msg.whyNow')}</dt><dd>{draft.brief.why_now}</dd>
                <dt>{t('msg.ask')}</dt><dd>{draft.brief.cta}</dd>
              </dl>
              <FocusEditor brief={draft.brief} busy={busy} onSave={saveFocus} t={t} />
              {draft.warnings.map((w, i) => <p key={i} className="s0-talk-note">{w.detail}</p>)}
              {draft.brief.channel === 'EMAIL' ? <input className="s0-blk-input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t('msg.subject')} /> : null}
              <textarea className="s0-blk-input" rows={10} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('msg.body')} />
              <div className="s0-today2-actions">
                <button type="button" className="s0-btn" disabled={busy || !body.trim()} onClick={iSentIt}>{t('msg.iSent')}</button>
                <button type="button" className="s0-btn-ghost" onClick={() => { void navigator.clipboard?.writeText(subject ? `${subject}\n\n${body}` : body).catch(() => undefined); }}>{t('msg.copy')}</button>
                {mailto ? <a className="s0-btn-ghost" href={mailto}>{t('msg.openEmail')}</a> : null}
                <button type="button" className="s0-linkbtn" disabled={busy} onClick={write}>{t('msg.again')}</button>
              </div>
            </div>
          ) : null}
          {sender ? <HowYouWrite businessId={businessId} t={t} /> : null}
        </div>
      </aside>
    </>
  );
}

/**
 * "Why this message focuses on X": BB's one relevance decision for this brief (the writer and every check use it), and her
 * correction: remove a part, add another of her verified services, correct the reason. Compact by design.
 */
function FocusEditor(props: { brief: CommunicationBriefView; busy: boolean; onSave: (parts: { offer_part: string; reason: string }[]) => void; t: Tr }) {
  const { brief, t } = props;
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState(brief.relevant_offer_parts.map((p) => ({ offer_part: p.offer_part, reason: p.reason })));
  useEffect(() => { setParts(brief.relevant_offer_parts.map((p) => ({ offer_part: p.offer_part, reason: p.reason }))); }, [brief]);
  if (!brief.offer_items.length) return null;
  const chosen = brief.relevant_offer_parts;
  const addable = brief.offer_items.filter((i) => !parts.some((p) => p.offer_part === i));
  const ok = parts.length <= 2 && parts.every((p) => p.reason.trim());
  if (!editing) {
    return (
      <div className="s0-msg-focus" data-focus={brief.relevance.source}>
        <p className="s0-today2-k">{chosen.length ? t('msg.focus.k', { parts: chosen.map((p) => p.offer_part).join(' + ') }) : t('msg.focus.none')}</p>
        {chosen.map((p) => <p key={p.offer_part} className="s0-talk-note">{p.offer_part}: {p.reason}{p.confidence === 'LOW' ? ` (${t('msg.focus.unsure')})` : ''}</p>)}
        {brief.relevance.source === 'founder' ? <p className="s0-talk-note">{t('msg.focus.yours')}</p> : null}
        <button type="button" className="s0-linkbtn" disabled={props.busy} onClick={() => setEditing(true)}>{t('msg.focus.change')}</button>
      </div>
    );
  }
  return (
    <div className="s0-msg-focus">
      <p className="s0-today2-k">{t('msg.focus.editK')}</p>
      {parts.map((p, i) => (
        <div key={p.offer_part} className="s0-today2-actions">
          <span>{p.offer_part}</span>
          <input className="s0-blk-input" value={p.reason} placeholder={t('msg.focus.reasonPh')} aria-label={t('msg.focus.reasonPh')}
            onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
          <button type="button" className="s0-linkbtn" onClick={() => setParts(parts.filter((_, j) => j !== i))}>{t('msg.focus.remove')}</button>
        </div>
      ))}
      {parts.length < 2 && addable.length ? (
        <select className="s0-blk-input" value="" aria-label={t('msg.focus.add')} onChange={(e) => e.target.value && setParts([...parts, { offer_part: e.target.value, reason: '' }])}>
          <option value="">{t('msg.focus.add')}</option>
          {addable.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      ) : null}
      <div className="s0-today2-actions">
        <button type="button" className="s0-btn" disabled={props.busy || !ok} onClick={() => { setEditing(false); props.onSave(parts); }}>{t('msg.focus.save')}</button>
        <button type="button" className="s0-linkbtn" onClick={() => setEditing(false)}>{t('msg.focus.cancel')}</button>
      </div>
    </div>
  );
}

/** Who signs, confirmed once per business (the account owner is only a suggestion). */
function SenderForm(props: { suggestion: SenderIdentityView | null; busy: boolean; onSave: (s: SenderIdentityView) => void; t: Tr }) {
  const { t } = props;
  const [s, setS] = useState<SenderIdentityView>(props.suggestion ?? { displayName: '', role: '', business: '', signOff: null });
  const ok = s.displayName.trim() && s.role.trim() && s.business.trim();
  return (
    <div>
      <p className="s0-today2-k">{t('msg.senderK')}</p>
      <p className="s0-talk-note">{t('msg.senderLead')}</p>
      <input className="s0-blk-input" value={s.displayName} onChange={(e) => setS({ ...s, displayName: e.target.value })} placeholder={t('msg.senderName')} />
      <input className="s0-blk-input" value={s.role} onChange={(e) => setS({ ...s, role: e.target.value })} placeholder={t('msg.senderRole')} />
      <input className="s0-blk-input" value={s.business} onChange={(e) => setS({ ...s, business: e.target.value })} placeholder={t('msg.senderBusiness')} />
      <input className="s0-blk-input" value={s.signOff ?? ''} onChange={(e) => setS({ ...s, signOff: e.target.value || null })} placeholder={t('msg.senderSignOff')} />
      <div className="s0-today2-actions"><button type="button" className="s0-btn" disabled={props.busy || !ok} onClick={() => props.onSave(s)}>{t('msg.senderConfirm')}</button></div>
    </div>
  );
}

/**
 * Evidence of how she writes: her real messages, outreach she liked, phrases she'd never use, five plain preferences.
 * BB shows what it uses and where each rule came from. Nothing inferred about her as a person.
 */
const PREFS: { key: 'greeting' | 'signoff' | 'length' | 'directness' | 'warmth'; ph: string }[] = [
  { key: 'greeting', ph: 'msg.pref.greeting' }, { key: 'signoff', ph: 'msg.pref.signoff' }, { key: 'length', ph: 'msg.pref.length' },
  { key: 'directness', ph: 'msg.pref.directness' }, { key: 'warmth', ph: 'msg.pref.warmth' },
];
function HowYouWrite({ businessId, t }: { businessId: string; t: Tr }) {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState('');
  const [liked, setLiked] = useState('');
  const [never, setNever] = useState('');
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [rules, setRules] = useState<WritingRuleView[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void getResults(businessId).then((r) => { setRules(r.writing.rules ?? []); setPrefs(r.writing.preferences ?? {}); }).catch(() => undefined);
  }, [open, businessId]);
  async function save(kind: 'SAMPLE' | 'LIKED' | 'NEVER_SAY' | 'PREFERENCE', text: string, clear: () => void, key?: string) {
    if (!text.trim()) return;
    try { const r = await addWriting(businessId, kind, text.trim(), key); clear(); setRules(r.rules ?? rules); setSaved(t('msg.writingSaved')); } catch { setSaved(t('common.actionFailed')); }
  }
  if (!open) return <div className="s0-today2-actions"><button type="button" className="s0-linkbtn" onClick={() => setOpen(true)}>{t('msg.howYouWrite')}</button></div>;
  const src = (r: WritingRuleView): string => (r.source === 'explicit' ? t('msg.rule.yours') : r.source === 'edits' ? t('msg.rule.edits') : r.source === 'edit' ? t('msg.rule.edit') : t('msg.rule.samples', { n: String(r.evidenceCount) }));
  // Three kinds of evidence, never shown as equal facts: what she told BB, what BB noticed across her writing, one edit.
  const groups = [
    { k: 'msg.rule.toldK', rs: rules.filter((r) => r.source === 'explicit') },
    { k: 'msg.rule.noticedK', rs: rules.filter((r) => r.source === 'samples' || r.source === 'edits') },
    { k: 'msg.rule.onceK', rs: rules.filter((r) => r.source === 'edit') },
  ].filter((g) => g.rs.length);
  return (
    <div className="s0-msg-writing">
      <p className="s0-today2-k">{t('msg.howYouWrite')}</p>
      <p className="s0-talk-note">{t('msg.samplesLead')}</p>
      <textarea className="s0-blk-input" rows={4} value={sample} onChange={(e) => setSample(e.target.value)} placeholder={t('msg.samplePh')} />
      <div className="s0-today2-actions"><button type="button" className="s0-btn-ghost" onClick={() => save('SAMPLE', sample, () => setSample(''))}>{t('msg.save')}</button></div>
      <textarea className="s0-blk-input" rows={3} value={liked} onChange={(e) => setLiked(e.target.value)} placeholder={t('msg.likedPh')} />
      <div className="s0-today2-actions"><button type="button" className="s0-btn-ghost" onClick={() => save('LIKED', liked, () => setLiked(''))}>{t('msg.save')}</button></div>
      <input className="s0-blk-input" value={never} onChange={(e) => setNever(e.target.value)} placeholder={t('msg.neverPh')} />
      <div className="s0-today2-actions"><button type="button" className="s0-btn-ghost" onClick={() => save('NEVER_SAY', never, () => setNever(''))}>{t('msg.save')}</button></div>
      {PREFS.map((p) => (
        <div key={p.key} className="s0-today2-actions">
          <input className="s0-blk-input" value={prefs[p.key] ?? ''} onChange={(e) => setPrefs({ ...prefs, [p.key]: e.target.value })} placeholder={t(p.ph)} aria-label={t(p.ph)} />
          <button type="button" className="s0-btn-ghost" onClick={() => save('PREFERENCE', prefs[p.key] ?? '', () => undefined, p.key)}>{t('msg.save')}</button>
        </div>
      ))}
      {rules.length ? (
        <div data-writing-rules="">
          <p className="s0-today2-k">{t('msg.rulesK')}</p>
          {groups.map((g) => (
            <div key={g.k} data-writing-group={g.k}>
              <p className="s0-talk-note">{t(g.k)}</p>
              <ul className="s0-verdict-list">{g.rs.map((r, i) => <li key={`${r.key}-${i}`}>{r.value} <span className="s0-talk-note">({src(r)}{r.scope ? `; ${t(`msg.scope.${r.scope.recipientCategory}`)}, ${t(`msg.scope.${r.scope.channel}`)}` : ''})</span></li>)}</ul>
            </div>
          ))}
        </div>
      ) : <p className="s0-talk-note">{t('msg.rulesNone')}</p>}
      {saved ? <p className="s0-talk-note">{saved}</p> : null}
    </div>
  );
}
