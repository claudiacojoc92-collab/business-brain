// BUS-16 — Body Move end-to-end acceptance (LIVE, real models, no login, no database).
//
// Input is PUBLIC page text only: the two fixtures under intent/2026-10-06-licensed-atoms/fixtures/, which are
// the visible text of bodymovestudio.ro (home + despre-noi) as production ingested it. Nothing internal, no
// founder answers. The ONE non-public input is the strategy direction (goal / audience / CTA), stated below
// verbatim from Body Move's adopted v17, because BB never drafts without an adopted strategy (fail closed).
//
// Pipeline (the same services production composes in packages/composition): public text → AtomExtractionService
// with the real AnthropicAtomModel (verbatim-anchored atoms) → assembleLandingMove → MoveDraftService with the
// real AnthropicLandingModel + judge (kernel, backstop, people-fidelity, judge layers) → a landing draft.
//
// Run (needs dist built and ANTHROPIC_API_KEY injected by compose; never read .env yourself):
//   npm run type-check
//   bash tools/preflight-env-key.sh && docker compose --profile app run --rm --no-deps -T -v "$PWD":/repo -w /repo \
//     --entrypoint node api tools/acceptance/bodymove-landing.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AtomExtractionService, assembleLandingMove, MoveDraftService } from '/repo/packages/application/dist/index.js';
import { AnthropicAtomModel } from '/repo/packages/infrastructure/dist/business-intelligence/anthropic-atom.model.js';
import { AnthropicLandingModel } from '/repo/packages/infrastructure/dist/business-intelligence/anthropic-landing.model.js';
import { AnthropicVoiceModel } from '/repo/packages/infrastructure/dist/business-intelligence/anthropic-voice.model.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('ANTHROPIC_API_KEY missing (run through docker compose so .env is injected)'); process.exit(2); }
const outDir = resolve(process.argv[2] ?? 'tools/acceptance/out');
mkdirSync(outDir, { recursive: true });

const FIX = '/repo/intent/2026-10-06-licensed-atoms/fixtures';
const PAGES = [
  { id: 'home', url: 'https://bodymovestudio.ro/', text: readFileSync(`${FIX}/bodymove-home.ingested.txt`, 'utf8') },
  { id: 'despre', url: 'https://bodymovestudio.ro/despre-noi/', text: readFileSync(`${FIX}/bodymove-despre.ingested.txt`, 'utf8') },
];
const fragment = (p) => ({ id: p.id, founderId: 'acceptance', source: 'website', platform: null, sourceUrl: p.url, confidenceKind: 'observed', occurredAt: null, capturedAt: new Date(0), visibility: 'business', payload: { ref: p.id, text: p.text }, derivedFrom: null });

// The site's OWN positioning, verbatim. In production these reach the generator as `synthesizedFacts` (BB's
// understanding of the business, built from the same pages); here they are quoted directly and asserted verbatim
// below, so the page can say what the business is in the business's own words. Public text only.
const SITE_POSITIONING = [
  'Un spațiu dedicat sănătății prin mișcare, recuperare și grijă autentică pentru corpul tău.',
  'Am creat un spațiu în care mișcarea, recuperarea și prevenția se întâlnesc pentru a oferi oamenilor soluții reale, adaptate nevoilor lor.',
  'De la antrenamente personale, clase și kinetoterapie până la recuperare postpartum și masaj, fiecare serviciu este construit pentru a susține un stil de viață activ și echilibrat.',
  'Body Move Studio este pentru tine dacă: îți dorești să îți îmbunătățești mobilitatea, postura și condiția fizică; te confrunți cu dureri, limitări de mișcare sau afecțiuni care necesită recuperare; ești însărcinată și cauți programe sigure de mișcare; te afli în perioada postpartum și ai nevoie de recuperare specializată; îți dorești să reduci tensiunile acumulate și să ai mai multă grijă de corpul tău; cauți activități care susțin dezvoltarea armonioasă a copilului tău; vrei să construiești obiceiuri sănătoase care să îți susțină starea de bine pe termen lung.',
];
const ALL_PUBLIC = PAGES.map((p) => p.text.replace(/\s+/g, ' ')).join(' ');
for (const s of SITE_POSITIONING) if (!ALL_PUBLIC.includes(s)) { console.error('NOT VERBATIM IN PUBLIC TEXT:', s); process.exit(2); }

// The adopted strategy direction (Body Move v17). Not public: stated here so the reader sees exactly what BB was told.
const STRATEGY = {
  strategyVersionId: 'bodymove-v17', goal: 'Mai multe paciente noi trimise de medici, pentru recuperare după naștere și accidentări',
  audience: 'femei trimise de medic pentru recuperare (postnatal, după accidentări)', ctaDirection: 'programează o evaluare',
};

let atomsSaved = [];
const atomService = new AtomExtractionService({
  links: { listFragmentIds: async () => PAGES.map((p) => p.id) },
  evidence: { findByIds: async () => PAGES.map(fragment) },
  model: new AnthropicAtomModel(key), modelId: 'live',
  repo: { latestFingerprint: async () => null, listAtoms: async () => atomsSaved, replaceForBusiness: async (_b, _f, a) => { atomsSaved = [...a]; } },
});

const t0 = Date.now();
const atoms = await atomService.facts('bodymove');
const tAtoms = Date.now();

const voice = new AnthropicVoiceModel(key);
const drafts = [];
const moveDraft = new MoveDraftService({
  model: new AnthropicLandingModel(key),
  judge: (i) => voice.checkPropositions(i),
  repo: { save: async (d) => { drafts.push(d); }, latestForAction: async () => null, get: async () => null },
  log: (e) => console.error('[move-draft]', JSON.stringify(e)),
});
const assembled = assembleLandingMove({
  ...STRATEGY, language: 'ro',
  atoms: atoms.map((a) => ({ value: a.value, atomClass: a.atomClass, sourceUrl: a.sourceUrl })),
  synthesizedFacts: SITE_POSITIONING, founderOwned: [], proofFacts: [], voiceLines: [], regulatedGuard: false,
}, { businessId: 'bodymove', actionId: 'acceptance-landing', planVersionId: 'acceptance' }, () => new Date().toISOString(), () => `acc-${Date.now()}`);
if (assembled.status !== 'ready') { console.error('BLOCKED:', assembled.message); process.exit(1); }
const md = await moveDraft.produceLanding({ businessId: 'bodymove', actionId: 'acceptance-landing', planVersionId: 'acceptance', snapshot: assembled.snapshot, communicationJob: assembled.communicationJob, voiceLines: assembled.voiceLines, language: 'ro' });
const tDraft = Date.now();

// Readable report: every atom with its source, then the page as a founder would read it.
const lines = [
  '# Body Move: landing page from public page text (BUS-16 acceptance, live)', '',
  `Run: ${new Date().toISOString()} · atoms ${((tAtoms - t0) / 1000).toFixed(0)}s · draft ${((tDraft - tAtoms) / 1000).toFixed(0)}s`,
  'Input: bodymovestudio.ro home + despre-noi visible text (public). Strategy direction: Body Move adopted v17.', '',
  `## What BB read from the public site: ${atoms.length} facts, each a verbatim quote with its source`, '',
  ...atoms.map((a) => `- **${a.atomClass}**: "${a.value.replace(/\s+/g, ' ')}" (${a.sourceUrl})`), '',
  `## The landing page BB wrote: status **${md.status}**`,
  `Safety gate: layers ${md.safetyDecision.layersRun.join(', ')} · failing layer ${md.safetyDecision.failingLayer ?? 'none'} · repairs ${md.safetyDecision.repairAttempts}`, '',
];
if (md.draft) {
  for (const s of md.draft.sections) lines.push(`### ${s.role}${s.heading ? `: ${s.heading}` : ''}`, s.body, '');
  lines.push(`**CTA:** ${md.draft.cta}`);
} else {
  lines.push('No draft (fail-closed). Failures:', ...md.safetyDecision.failures.map((f) => `- ${f.section} / ${f.layer} / ${f.rule}`));
}
writeFileSync(resolve(outDir, 'bodymove-landing.md'), lines.join('\n') + '\n');
writeFileSync(resolve(outDir, 'bodymove-landing.json'), JSON.stringify({ atoms, moveDraft: md }, null, 2));
console.log(lines.join('\n'));
process.exit(md.status === 'drafted' ? 0 : 1);
