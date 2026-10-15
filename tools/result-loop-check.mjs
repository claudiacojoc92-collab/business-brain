// Result Loop V1 — Body Move acceptance (intent/2026-10-14-result-loop). Real models, IN-MEMORY stores: writes nothing
// anywhere (no DB, no prod, no files). Reads .env INSIDE node (never shell-sourced); the key is never printed.
// Run from the repo root after `npx tsc -b`:   node tools/result-loop-check.mjs        Cost: ≈ $1–3.
// With the founder's REAL writing (BUS-80):     node tools/result-loop-check.mjs --writing <path/to/writing.json>
//   The file stays wherever the operator keeps it (it is the founder's private writing; never commit it). Format:
//   tools/result-loop-writing.example.json.
//
// Acceptance DATA only (never production logic): Body Move's held direction as the founder stated it (medical referral
// channel), what she told BB, two real organisations BB verified on their own sites (recuperarecluj.ro, gralmedical.ro),
// and one TEST doctor (fictional name, flagged) for the first-outreach case.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const key = env.ANTHROPIC_API_KEY ?? '';
console.log(`ANTHROPIC_API_KEY: ${key ? 'present' : 'MISSING'}`);
if (!key) process.exit(1);
process.env.ANTHROPIC_MAX_RETRIES = '2';
const model = env.LLM_STRONG_MODEL || 'claude-sonnet-4-6';

const app = await import('../packages/application/dist/index.js');
const rl = await import('../packages/infrastructure/dist/business-intelligence/anthropic-result-loop.models.js');
const { AnthropicImpactModel } = await import('../packages/infrastructure/dist/business-intelligence/anthropic-impact.model.js');

const B = 'body-move';
let clock = new Date('2026-10-14T09:00:00Z');
const repos = app.inMemoryResultLoopRepos();
const results = new app.ResultLoopService({ ...repos, now: () => clock });
const writing = new app.InMemoryWritingRepository();

// What BB holds about Body Move (from the 2026-10-14 read-only prod snapshot + the founder's own words).
const STRATEGY = { goal: 'Activarea canalului B2B medical și mai mulți clienți pe toate serviciile în 6–12 luni', bet: 'medici și secții de recuperare care trimit pacienți la Body Move', referrer: 'medici și clinici care văd pacienții după tratament' };
const FOUNDER_SAID = [
  '2 medici confirmați, unul a trimis 3 paciente',
  'Canalele de achiziție active sunt recomandările și contentul organic, fără paid sau parteneriate active',
  'Echipa prenatală acoperă ambele locații',
];
const OFFER = 'Kinetoterapie, Pilates, gimnastică prenatală și recuperare postpartum, masaj, în două locații din Cluj-Napoca (Bună Ziua și Decebal)';
const comms = new app.CommunicationService({
  results: repos, resultService: results, writing,
  context: { strategy: async () => STRATEGY, todayMove: async () => null, founderSaid: async () => FOUNDER_SAID, constraints: async () => ['fără reclame plătite'], businessOffer: async () => OFFER },
  model: new rl.AnthropicMessageModel(key, model), judge: new rl.AnthropicSendabilityJudge(key, model), grounder: new rl.AnthropicClaimGrounder(key, model), relevance: new rl.AnthropicRelevanceModel(key, model), now: () => clock,
}).withLanguage(async () => 'ro');
// Founder writing evidence (optional): her real messages, outreach she liked, never-say, preferences, past edits.
const wi = process.argv.indexOf('--writing');
const W = wi > 0 ? JSON.parse(readFileSync(process.argv[wi + 1], 'utf8')) : null;
await comms.confirmSender(B, W?.sender ?? { displayName: 'Raluca', role: 'fondatoare', business: 'Body Move Studio', signOff: null });
if (W) {
  // A sample is a string (context unknown: a voice example only, shapes no rule) or { text, recipient, channel, purpose }
  // (recipient: medical | organisation | individual; channel: EMAIL | WHATSAPP): its rules hold for that context only.
  for (const s of W.samples ?? []) {
    const o = typeof s === 'string' ? { text: s } : s;
    await comms.addWriting(B, 'SAMPLE', o.text, null, { recipientCategory: o.recipient, channel: o.channel, purpose: o.purpose });
  }
  for (const s of W.liked ?? []) await comms.addWriting(B, 'LIKED', s);
  for (const s of W.neverSay ?? []) await comms.addWriting(B, 'NEVER_SAY', s);
  for (const [k, v] of Object.entries(W.preferences ?? {})) if (v) await comms.addWriting(B, 'PREFERENCE', String(v), k);
  // A past edit = a draft she changed before sending: each one logged against its own throwaway contact (independent
  // edits, pure writing evidence), with the message's purpose when the file gives it.
  for (const [i, e] of (W.edits ?? []).entries()) {
    // The throwaway contact carries the edit's register context (recipient: medical | organisation | individual).
    const who = e.recipient === 'medical' ? { type: 'PERSON', role: 'medic' } : e.recipient === 'organisation' ? { type: 'ORGANISATION', organisationName: 'Organisation' } : { type: 'PERSON' };
    const ec = await results.addContact(B, { ...who, name: `Edit evidence ${i + 1} (acceptance only)` }, { kind: 'founder' });
    await comms.markSent(B, ec.id, { messageId: `edit-${i}`, subject: null, body: e.final, draftBody: e.draft, channel: e.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL', ...(e.purpose ? { purpose: e.purpose } : {}) });
  }
}
const prof = await comms.profile(B);
const hr = (t) => console.log(`\n${'═'.repeat(8)} ${t} ${'═'.repeat(Math.max(4, 60 - t.length))}`);
hr('FOUNDER WRITING EVIDENCE');
console.log(W ? `samples: ${prof.samples.length} · liked: ${prof.liked.length} · never-say: ${prof.neverSay.length} · removed in one edit (soft): ${prof.rejectedInContext.length} · own samples: ${prof.samples.length} · accepted BB drafts: ${prof.acceptedDrafts} · preferences: ${Object.keys(prof.preferences).join(', ') || '-'}`
  : '(none given: GENERIC DEFAULTS. Pass --writing <file> for the real-founder run)');
for (const r of prof.rules) console.log(`  · ${r.key}: ${r.value.replace(/\n/g, ' / ')}   [${r.source}; entries ${r.evidence.join(', ')}]`);

// Contacts.
const doctor = await results.addContact(B, { type: 'PERSON', name: 'Dr. Andrei Mureșan (TEST)', role: 'medic ortoped', organisationName: 'cabinet privat de ortopedie, Cluj', email: 'test@example.com' }, { kind: 'founder' });
const hospital = await results.addContact(B, { type: 'ORGANISATION', name: 'Spitalul Clinic de Recuperare Cluj-Napoca', role: 'secția Recuperare, Medicină Fizică și Balneologie', email: 'manager@recuperarecluj.ro' }, { kind: 'founder' });
const gral = await results.addContact(B, { type: 'ORGANISATION', name: 'Gral Medical Cluj', role: 'clinică', email: 'contact@gralmedical.ro' }, { kind: 'founder' });

// Case B history: Raluca's team visited the hospital; they asked for the brochure by email.
await results.logTouch(B, { contactId: hospital.id, channel: 'VISIT', type: 'VISITED', summary: 'Am trecut pe la secretariat și am lăsat o broșură', occurredAt: '2026-10-10T10:00:00Z', source: { kind: 'founder' }, createdBy: 'FOUNDER' });
await results.recordOutcome(B, { contactId: hospital.id, outcomeType: 'MATERIAL_REQUESTED', note: 'au cerut broșura pe email', occurredAt: '2026-10-10T10:10:00Z', evidence: { kind: 'founder' }, createdBy: 'FOUNDER' });
await results.openFollowUp(B, { contactId: hospital.id, what: 'Trimite broșura pe email', reason: 'au cerut broșura pe email', dueOn: '2026-10-14', createdBy: 'BB' });
// Case C history: she wrote to Gral 9 days ago; no answer.
await results.logTouch(B, { contactId: gral.id, channel: 'EMAIL', type: 'SENT', summary: 'I-am scris despre pacienții care au nevoie de kinetoterapie după consultație', occurredAt: '2026-10-05T09:00:00Z', source: { kind: 'message' }, createdBy: 'FOUNDER' });

async function show(label, contact) {
  hr(label);
  const d = await comms.draft(B, contact.id, { trace: true }); // acceptance only: every attempt (the API never shows a failed draft)
  if (d.status === 'needs_input') { console.log('NEEDS INPUT:', d.problems.map((p) => p.detail).join(' | ')); return; }
  const b = d.brief;
  console.log(`BRIEF · purpose=${b.purpose} · to=${b.recipient_identity.name} (${b.recipient_role ?? '-'})`);
  console.log(`  relationship: ${b.relationship_context}`);
  console.log(`  why now: ${b.why_now}`);
  console.log(`  desired outcome: ${b.desired_outcome}`);
  console.log(`  the one ask: ${b.cta}`);
  console.log(`  facts available (held): ${b.available_facts.join(' · ') || '-'}`);
  console.log(`  facts needed in THIS message (${b.facts_use}): ${b.supporting_context.join(' · ') || '(none)'}`);
  console.log(`  verified offer parts: ${b.offer_items.join(' · ')}`);
  console.log(`  RELEVANT OFFER PARTS (decided once; source=${b.relevance.source}${b.relevance.uncertain ? ', UNCERTAIN' : ''}):`);
  if (!b.relevant_offer_parts.length) console.log('    (none: the message may name no service)');
  for (const p of b.relevant_offer_parts) {
    console.log(`    · ${p.offer_part} [${p.confidence}] — reason: ${p.reason}\n        evidence: ${p.evidence.length ? p.evidence.map((e) => `"${e}"`).join(' · ') : '(none verified)'}`);
    if (p.droppedReason) console.log(`        model's reason DROPPED (ungrounded: ${p.ungroundedTerms.join(', ')}): ${p.droppedReason}`);
  }
  console.log(`  max words: ${b.length.maxWords} · language: ${b.language}`);
  for (const a of d.trace ?? []) {
    console.log(`\n── attempt ${a.attempt}${a.attempt > 1 ? ' (repair)' : ' (initial draft)'} ──`);
    if (!a.message) { console.log('  (writer returned nothing usable)'); continue; }
    console.log(`Subject: ${a.message.subject ?? '-'}\n${a.message.body}`);
    console.log(`  deterministic: ${a.deterministic.length ? '' : 'pass'}`); for (const r of a.deterministic) console.log(`    ✗ ${r.code}: ${r.detail}`);
    if (a.claims) { console.log('  claims:'); for (const c of a.claims) console.log(`    · [${c.kind}/${c.verdict}] ${c.claim}  ← ${c.support ? `"${c.support}"` : '(no support)'}`); }
    if (!a.deterministic.length) { console.log(`  grounding: ${a.grounding.length ? '' : 'pass'}`); for (const r of a.grounding) console.log(`    ✗ ${r.code}: ${r.detail}`); }
    if (a.judge) { console.log(`  judge: ${a.judge.length ? '' : 'pass'}`); for (const r of a.judge) console.log(`    ✗ ${r.detail}`); }
  }
  if (d.status === 'failed') {
    console.log(`\nFAILED after ${d.attempts} attempts (no draft shown).`);
    for (const r of d.reasons) console.log(`  ✗ ${r.code}: ${r.detail}`);
    if (d.clarify.length) console.log(`  What would help: ${d.clarify.join(' | ')}`);
    return;
  }
  console.log(`\nREADY after ${d.attempts} attempt(s)${d.attempts > 1 ? ' (repaired)' : ''}\nSubject: ${d.message.subject ?? '-'}\n\n${d.message.body}`);
  if (b.writing_rules.length) {
    const broken = app.checkWritingRules(d.message, b).map((f) => f.detail);
    console.log('\nFounder-writing rules in this brief → final draft:');
    for (const r of b.writing_rules) console.log(`  ${['greeting', 'signoff', 'formality', 'punctuation'].includes(r.key) ? (broken.some((x) => x.toLowerCase().includes(r.key === 'signoff' ? 'signs off' : r.key === 'greeting' ? 'opens with' : r.key === 'formality' ? 'second person' : 'never uses')) ? '✗' : '✓') : '·'} ${r.key}: ${r.value.replace(/\n/g, ' / ')} [${r.source}]`);
  }
}

await show('A · first outreach to a doctor (TEST contact)', doctor);
await show('B · follow-up after the brochure was requested', hospital);
await show('C · follow-up after no response (9 days)', gral);

// ── The outcome trace: report → BB's reading → (founder confirms) → typed state → evaluator → Today ──
hr('OUTCOME TRACE');
const REPORT = 'Reprezentantul a vizitat cinci clinici. Două nu au fost interesate. Două au cerut broșura pe email. Un medic vrea să revenim.';
console.log(`Founder report: "${REPORT}"`);
const dueBefore = (await results.due(B)).map((d) => `${d.followUp.what} (${d.contact.name})`);
const contacts = (await results.views(B)).map((v) => v.contact);
const raw = await new rl.AnthropicResultReportModel(key, model).parse({ statement: REPORT, language: 'ro', contacts: contacts.map((c) => ({ id: c.id, name: c.name, organisationName: c.organisationName, role: c.role })) });
const parsed = app.checkParsedReport(raw, REPORT, contacts);
console.log(`\nBB's reading (${parsed.items.length} items; the founder would confirm / correct each):`);
for (const it of parsed.items) console.log(`  · ${it.contact.name ?? `(unnamed ${it.contact.type.toLowerCase()})`} — ${it.touch?.type ?? '-'} / ${it.outcome?.type ?? '-'}${it.followUp ? ` → owed: ${it.followUp.what} in ${it.followUp.dueInDays}d` : ''}   «${it.quote}»`);
if (parsed.unclear.length) console.log(`  unclear: ${parsed.unclear.join(' | ')}`);
const written = await results.applyConfirmedReport(B, REPORT, parsed.items); // = the founder confirming as-is
const evidence = await results.evidence(B);
const today = app.todayFactFromReport(written.currentBefore, written.currentAfter, written.followUps); // same as the API route
const CORE = {
  goal: STRATEGY.goal, coreBet: { priority: STRATEGY.bet, deprioritized: 'reclame plătite și content ca motor principal' }, diagnosis: 'Recomandările medicale funcționează deja (2 medici), dar canalul nu e activat sistematic.',
  assumptions: [{ statement: 'Medicii și clinicile din Cluj trimit pacienți dacă știu de Body Move și au un pas simplu de urmat' }],
  reconsiderTriggers: [{ condition: 'Mai puțin de 2 recomandări noi în 8 săptămâni de la începerea contactării sistematice' }, { condition: 'Dacă peste jumătate din clinicile contactate refuză explicit' }],
  notNow: [{ item: 'reclame plătite' }],
};
const impact = new app.ImpactService({
  understanding: { latest: async () => ({ understanding: { offer: { summary: OFFER }, audience: { addressed: ['persoane cu dureri sau limitări de mișcare', 'femei însărcinate și mame după naștere'] }, acquisition: { visiblePaths: ['recomandări', 'content organic'] }, unknowns: [] } }) },
  state: { listActive: async () => FOUNDER_SAID.map((statement) => ({ kind: 'resource', statement })), append: async () => { throw new Error('an outcome must never be written as founder_state'); } },
  strategy: { getCurrent: async () => ({ record: { bundle: { core: CORE } }, adoptedAt: 't' }), recordFounderInput: async () => { throw new Error('no'); }, regenerate: async () => ({ id: 'v-new', version: 2, status: 'proposal', bundle: {} }) },
  model: new AnthropicImpactModel(key, model),
});
const { result } = await impact.evaluate(B, 'founder', 'Body Move Studio', 'outcome_report', REPORT, 'ro', { results: { evidence, today } });
console.log(`\nWritten: ${written.contacts.length} contacts, ${written.touches.length} touches, ${written.outcomes.length} outcomes, ${written.followUps.length} follow-ups (no founder_state).`);
console.log(`Cumulative evidence:\n  ${result.evidence?.statements.join('\n  ')}`);
console.log(`Reconsider conditions vs the counts:\n${(result.evidence?.conditions ?? []).map((c) => `  - ${c.condition}: ${c.state} (${c.detail})`).join('\n') || '  (none structured)'}`);
console.log(`\nVERDICT: ${result.verdict}`);
console.log(`  strategy: ${result.strategyImpact.changes ? 'changes (proposal drafted, founder adopts)' : result.strategyImpact.reasonCode}`);
console.log(`  what changed: ${result.whatChanged.join(' | ')}`);
console.log(`  what didn't: ${result.whatDidNotChange.join(' | ')}`);
console.log(`  assumptions: ${result.assumptionImpacts.map((a) => `${a.direction}: ${a.assumption}`).join(' | ') || '-'}`);
console.log(`\nTODAY before: ${dueBefore.join(' · ') || '(nothing due)'}`);
console.log(`TODAY after:  ${(await results.due(B)).map((d) => `${d.followUp.what} (${d.contact.name})`).join(' · ') || '(nothing due today)'}`);
console.log(`Current move before: ${written.currentBefore ? `${written.currentBefore.what} (${written.currentBefore.contactName})` : '(none)'} · after: ${written.currentAfter ? `${written.currentAfter.what} (${written.currentAfter.contactName})` : '(none)'}`);
console.log(`Today impact: ${result.todayImpact.changes ? `CHANGED → ${result.todayImpact.newMove} (because: ${result.todayImpact.reason ?? result.todayImpact.reasonCode})` : `UNCHANGED (${result.todayImpact.reasonCode})`}`);
console.log(`Execution queue: ${result.todayImpact.followUpsAdded ? `${result.todayImpact.followUpsAdded.count} new follow-up(s) added, first due ${result.todayImpact.followUpsAdded.firstDueOn}` : 'no follow-ups added'}`);
clock = new Date('2026-10-15T09:00:00Z');
console.log(`TODAY tomorrow: ${(await results.due(B)).map((d) => `${d.followUp.what} (${d.contact.name})`).join(' · ') || '(nothing due)'}`);
