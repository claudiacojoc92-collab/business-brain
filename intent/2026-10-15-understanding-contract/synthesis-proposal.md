# Understanding: from extraction to structure. Proposal for product review

**Status:** proposal, NOT implemented. 2026-10-15. Inputs (all read-only prod): Blind Test 2 snapshot
`01M4YXMRY7JS6VHT8BA7WCTAWR` (the only one; byte-identical to the regression fixture), the card it projects to, and the
10 pages that read used (homepage, despre-noi, servicii, clase-personal-training, kinetoterapie, gimnastica-prenatala,
masaj, locatii, locatii/buna-ziua, programari).

---

## 1. What the founder sees, line by line

| # | Card | Line (shortened) | Class |
|---|---|---|---|
| 1 | What I understand | "Vinzi clase…, kinetoterapie, programe pre- și postnatale și masaj, în două locații…" | extraction |
| 2 | | "Site-ul prezintă Body Move ca un spațiu integrat…" | extraction (positioning restated) |
| 3 | | "For: adulți activi…, mame…, copii" | extraction |
| 4 | | Offer: four service families | extraction |
| 5 | | Offer: Kinetoterapie only at Decebal, not Bună Ziua | extraction (an asymmetry is *noticed*, then stated as a bare fact with no relationship drawn; the closest thing to synthesis on the card) |
| 6 | | Conversion: booking via Evo Beauty or reception | extraction (FAQ restated) |
| 7 | | Capacity: Group Training max 4 people | extraction (single fact) |
| 8 | | Economics: 90 to 220 lei per session | extraction |
| 9 | | **Stage: growth** + 4 reasons | **unsupported** (see §6) |
| — | What seems to matter | *(card absent: 0 tensions, diagnosis not_ready)* | — |
| 10 | Not ready to conclude | "I can't tell yet: who buys most, how customers find you, who comes back, what's growing, what you want to grow" | honest, but inventory of gaps |
| 11 | | "De unde vin clienții noi" | generic refusal |
| 12 | | "Dacă Kinetoterapia lipsește de la Bună Ziua din cauza spațiului, personalului sau unei decizii" | **hypothesis-adjacent**: the one real fork, but framed as a refusal |
| 13 | What I need from you | Q1 top-3 by bookings / by revenue. *Why:* "priorities change completely" | questionnaire; why = generic |
| 14 | | Q2 where new clients come from. *Why:* referrals vs organic change the logic of paid ads | questionnaire; why = generic (fits any business) |
| 15 | | Q3 subscription vs per-session + renewal. *Why:* "if most pay per session, revenue is unpredictable and pricing deserves reconsideration" | questionnaire; **why = unsupported** (see §6) |
| — | *(cut)* | Q4 "Kinetoterapie only at Decebal: space, staff or deliberate?" | **the only discriminating question**, ranked 4th, so it never shows |

**Tally:** 9 extraction, 0 synthesis, 1 hypothesis-adjacent line (12), 2 generic question explanations, 2 unsupported
items (stage block, Q3's why). The discriminating question exists but is cut.

---

## 2. Why almost everything becomes extraction (the trace)

1. **The contract has no place for synthesis.** The model's only reasoning fields are:
   - `read.model.known` (contract: "ONE short claim" per dimension → single-dimension by construction);
   - tensions (8 misalignment kinds, verbatim quote each, mostly communication-shaped);
   - Aha (contract: "an OBSERVED fact… never speculation");
   - diagnosis (cannot pass without the founder's goal).

   A cross-dimension pattern held as a hypothesis has no field. The order of work is model → tensions → diagnosis,
   with no "relate the facts" step in between.
2. **Governance kills the hedge, correctly but indiscriminately.** SPECULATION / MODAL / INFERENCE are right for
   *assertions*. A hypothesis is necessarily modal ("may", "seems"). With no hypothesis type that carries its own
   alternative and discriminator, every hedged structural thought reads as speculation. It ends up either suppressed at
   the prompt or demoted to hidden buckets.
3. **Projection prefers inventory.**
   - The first card is the dimension list: 2 lines × dimension.
   - These are never projected: `websiteNotes`, `read.observations`, `notConcluding` marked unsupported,
     `audience.appearsTargeted`, `stage.secondary`.
   - Question ranking scores by `changes.length` and unknown dimension, then *strategic sufficiency* reserves the
     performance and acquisition slots. Coverage questions always beat fork questions.
4. **The evidence for structure was read and never used.** The schedule (location × instructor × hour), the team list
   per location, and "every program starts with an evaluation" on the therapy pages were all in the input. No
   instruction asks the model to relate them. `read.model.capacity` does not mention the schedule at all.
5. **Question explanations are ungoverned.** `governUnderstanding` checks `question` (hygiene, housekeeping) but copies
   `why` through untouched (`understanding-governance.ts:202`). No BEHAVIOUR / ECONOMICS / SPECULATION gate applies.

## 3. Synthesis that existed in the pipeline and was lost

| Where it sits in the stored read | What it says | Relationship | Why the founder never sees it |
|---|---|---|---|
| `websiteNotes[3]` | Kinetoterapie only at Decebal, yet the homepage presents it as central | offer × location × positioning | filed as a website note (communication critique); websiteNotes are not projected |
| `audience.appearsTargeted[0]` | maternity looks prioritised: own page, several services, daily classes, dedicated specialist | offer × capacity × customer | not projected (only the `serves` summary is) |
| `notConcluding` (unsupported) | 4/8/12 packs on almost every service "create retention through prepayment" | offer × retention | asserted, not hedged, so correctly demoted; hidden |
| `stage.secondary` | Schroth is priced but in no schedule → "new, or insufficient demand" | offer × capacity | hidden, and **wrong without an alternative**: Schroth is one-to-one therapy and the schedule lists group classes only (one-to-one kinetoterapie isn't there either). The case for making `alternative` mandatory |
| `read.questions[4]` | kinetoterapie at Decebal only: a limit, or deliberate? | the only discriminating question | ranked 4th of 3 slots |

**Conclusion:** fragments of synthesis exist, but nothing makes them legitimate, they are misfiled into hygiene and
refusal buckets, and projection shows the inventory instead.

---

## 4. Proposed architecture (smallest coherent change)

There is no migration: everything lives in the existing `understanding` jsonb. Old snapshots have no `structure`, so
the card falls back to the current view.

### 4.1 New primitive: `read.structure`

```ts
interface BusinessStructure {
  synthesis: string;                       // ≤ 2 sentences: what this business actually is (structurally), hedged when inferred
  hypotheses: StructuralHypothesis[];      // 0..3; zero is a valid answer
}
interface StructuralHypothesis {
  hypothesis: string;                      // may be modal ("may", "seems"): the ONLY prose field exempt from SPECULATION/MODAL
  relationship: 'asymmetry' | 'divergence' | 'sequence' | 'concentration' | 'dependency' | 'mismatch';
  between: string[];                       // ≥ 2 named entities of THIS business (offers, locations, people, segments)
  dimensions: ModelDimension[];            // ≥ 2 (offer, capacity, customer…)
  evidence: { ref: string; quote: string }[]; // ≥ 2 anchored quotes, from ≥ 2 distinct facts
  counts?: CountClaim[];                   // see 4.3
  numbers?: NumberClaim[]; calculations?: Calculation[];
  whyItMatters: string;                    // which decision depends on it; never an outcome
  changes: StrategicDecision[];            // ≥ 1
  alternative: string;                     // REQUIRED: what else explains the same evidence
  discriminator: { unknown: string; question: string }; // the answer that tells the two readings apart
}
```

No confidence scores. The epistemic basis is structural: `inferred`, resting on the quoted observed facts.

### 4.2 Deterministic gate: `governStructure` (new, beside `governFindingsDetailed`)

A hypothesis is kept only when all of these hold:

- **Synthesis, not restatement:**
  - ≥ 2 evidence quotes, anchored on trusted pages (reuse `anchorClaimEvidence` + source trust), not from the same
    sentence;
  - ≥ 2 dimensions;
  - `between` names ≥ 2 entities found in `businessEntities` (offer names, locations, named people).
- **Anti-generic:** the entity test above is the deterministic "can't be pasted onto 1,000 businesses" check. A GENERIC
  phrase list (different audiences/needs, pricing matters, retention matters, focus, social proof, multiple locations add
  complexity, recurring revenue is better) rejects the item unless it names ≥ 2 of this business's entities.
- **Epistemics:**
  - `hypothesis` may be modal, but BEHAVIOUR, ECONOMICS (profitability, margin, revenue potential) and FOUNDER_CHOICE as
    fact stay banned;
  - numbers go through `groundNumbers`; counts go through the count check (4.3);
  - `whyItMatters` must name a decision (`changes` non-empty) and passes SPECULATION + BEHAVIOUR + ECONOMICS + a new
    CONSEQUENCE gate (see 4.4).
- **Alternative and discriminator:**
  - `alternative` must be non-empty and not `sameInsight` with the hypothesis, so a negation paraphrase fails;
  - the discriminator question must be non-empty and pass the question gates.
- **Hygiene:** `isWebsiteHygiene` → never a hypothesis.
- Rejected items go to a `structureAudit` with the same kept/demoted/dropped grammar as Aha, for the acceptance harness.
  They are never shown.

### 4.3 Count grounding (small extension of numeric grounding)

Structural observations are often counts: "25 classes vs 9", "10 of 28", "four kinetoterapeuți". A `CountClaim`
`{ value, of, items: {ref, quote}[] }` lists the items counted. Code checks that each item is anchored and that
`items.length === value`. Without this, the strongest structural evidence (the composition of the schedule and the
team) cannot be shown under the current "every digit grounded" rule.

### 4.4 Question explanations under the same rules

- Gate `why` with BEHAVIOUR, ECONOMICS, SPECULATION and a new CONSEQUENCE pattern: a predicted state of the business
  from a hypothetical answer ("revenue is unpredictable", "X becomes the priority", "deserves reconsideration"). A
  failing `why` is blanked, not rewritten.
- Allowed form: "This tells me whether A or B" / "This decides …".
- A question can carry `resolves: <hypothesis index>`. Its `why` is then derived from that hypothesis ("tells me whether
  {hypothesis} or {alternative}"), so the explanation is a fork by construction.
- **Ranking:** discriminator questions of kept hypotheses rank first. A discriminator that also fills performance or
  acquisition satisfies strategic sufficiency, so it's one slot, not two. Remaining slots follow today's sufficiency
  rule.

### 4.5 Stage

`governStage` keeps a stage label only when **performance** evidence exists: founder-declared volume, trend, or
capacity use; or observed dated evidence of change. Footprint (locations, team size, number of services, a published
schedule) can never earn a stage. Otherwise:

- stage = `undetermined`, and it is not rendered;
- the stored lines stay for audit;
- the same rule applies to `secondary`.

Its place on the card goes to one honest "not concluding" line (see the mock).

### 4.6 Prompt

- New section STRUCTURE, between the business model and tensions in the order of work: "relate the facts: where do
  offers, locations, people, prices, schedule and entry paths line up or diverge?"
- Field rules as above. Only an **invented, non-Body-Move** example, per the existing rule: never put the case in the
  prompt.
- Explicit permission: zero hypotheses is valid.

### 4.7 Card (projection + `UnderstandingReadView`)

1. **What I think this business is**: `structure.synthesis`.
2. **What I noticed**: 1 to 3 hypotheses. Each shows the hypothesis, "What else could explain it" (alternative), and
   the evidence on demand (existing `<details>`).
3. **What could change my read**: one line per hypothesis (the fork), plus the "not concluding" stage line.
4. **What I need from you**: 2 to 3 discriminating questions.

The 9-dimension model stays underneath and moves behind a collapsed "What I read" disclosure: provenance kept,
inventory demoted. Headings stay English; content follows `content_language` (RO here).

### 4.8 Scope and verification

- **Files:**
  - contracts + `model-shapes` normalisation;
  - prompt + prompt test;
  - `governStructure` + count grounding + `why` gate + stage rule;
  - projection;
  - `UnderstandingReadView` + `messages.ts` keys.
- **Tests:** fixtures from the BT2 pages for kept / rejected / generic / single-fact / missing-alternative items.
- **Acceptance:** the dogfood harness, ≥ 3 runs on the BT2 fragments, plus one non-Body-Move business to catch
  genericity, then a live check of the founder card.
- **Main risk:** a hypothesis that passes the gates and is still semantically wrong (the Schroth case). The mandatory
  alternative is the guard; acceptance must read every kept hypothesis by hand.

---

## 5. Mocked founder-facing output (Blind Test 2 evidence only)

**Hand-written by me from the 10 pages above, as the target contract would require.** It is not model output, and
real runs will be noisier. Every number below is in the pages or is a count of quoted items. RO is what would render;
EN follows.

### RO (as rendered; headings English)

**What I think this business is**
Din ce am citit, Body Move pare să fie trei afaceri sub un singur nume: clase de grup vândute dintr-un orar public, la
90–120 lei ședința; terapie unu-la-unu (kinetoterapie, Terapia Schroth, planșeu pelvin), care începe cu o evaluare de
200 de lei; și masaj. Se cumpără diferit și le livrează oameni diferiți.

**What I noticed**

1. **Cele două locații nu par două copii ale aceluiași studio.** Bună Ziua duce cea mai mare parte a orarului (25 de
   clase de luni până joi, față de 9 la Decebal) și tot blocul de dimineață pentru sarcină și postpartum. Decebal este
   singura locație listată cu kinetoterapie, iar orarul ei e înclinat spre postură și copii (Pilates Postural,
   Kinetoterapie posturală 10–15 ani, Balet Copii). Locațiile ar putea juca roluri diferite.
   *Ce altceva ar putea explica asta:* împărțirea poate urma doar sălile sau echipamentul, nu o decizie. Echipa de la
   Bună Ziua include un kinetoterapeut, deci nu pare o lipsă de oameni.

2. **Linia pentru mame arată ca un parcurs, nu ca un serviciu.** Gimnastica prenatală, evaluarea postpartum, recuperarea
   postpartum (grup și individual) și planșeul pelvin urmăresc aceeași femeie de la sarcină până după naștere. La Bună
   Ziua, 10 din cele 28 de clase din orar sunt ale acestei linii, toate cu Cristina Mureșan, inclusiv toate orele de
   marți și joi dintre 9 și 11.
   *Ce altceva ar putea explica asta:* multe cliente pot veni pentru o singură etapă; atunci sunt câteva servicii
   scurte care împart o specialistă.

3. **Orarul arată clasele. Terapia nu se vede.** Echipa are cel puțin patru kinetoterapeuți, iar terapia are cel mai
   mare preț pe ședință din listă (Terapia Schroth, 220 lei) și abonamente de până la 2 160 lei. Totuși, singura
   terapie dintr-un orar e o clasă de postură pentru copii, la Decebal. Terapia ar putea fi o parte mai mare a afacerii
   decât lasă să se vadă un site construit în jurul orarului.
   *Ce altceva ar putea explica asta:* kinetoterapeuții pot lucra cu jumătate de normă sau mai ales în altă parte, iar
   terapia poate fi mică.

**What could change my read**
- Dacă împărțirea între locații ține de săli, sunt o singură afacere cu două adrese.
- Dacă cele mai multe mame vin pentru o singură etapă, linia pentru mame e un set de servicii, nu un parcurs.
- Dacă terapia e o parte mică din ore și din venit, orarul de clase este chiar afacerea.
- Nu numesc încă etapa afacerii: două locații și un orar publicat se potrivesc la fel de bine cu o afacere care crește,
  una stabilă sau una cu locuri libere.

**What I need from you**
1. Luna trecută, cum s-a împărțit afacerea între clase, terapie și masaj: a) ca venit, b) ca număr de vizite?
   *Why I ask:* îmi spune dacă afacerea o duc clasele sau terapia, primul lucru pe care trebuie să-l știe un plan.
2. Oferta mai îngustă de la Decebal este o alegere sau o limită (săli, echipament, oameni)?
   *Why I ask:* îmi spune dacă planific locațiile ca una sau ca două.
3. Din femeile care fac gimnastică prenatală la voi, cam câte revin pentru recuperarea postpartum?
   *Why I ask:* îmi spune dacă linia pentru mame e un parcurs sau servicii separate, ceea ce schimbă cum o oferi și cum
   o măsori.

*(collapsed)* What I read: the 9-dimension model, as today.

### EN (for review)

**What I think this business is.** From what I read, Body Move seems to be three businesses under one name:
- group classes sold from a public timetable at 90–120 lei a session;
- one-to-one therapy (kinetoterapie, Schroth, pelvic floor) that starts with a 200-lei evaluation;
- massage.

They are bought differently and delivered by different people.

**What I noticed.**

1. *The two locations don't look like copies.*
   - Bună Ziua carries most of the timetable (25 classes Mon–Thu vs 9 at Decebal) and the whole morning
     pregnancy/postpartum block.
   - Decebal is the only location listed with kinetoterapie, and its timetable leans to posture and children.
   - The locations may play different roles.
   - **Alternative:** the split may just follow rooms or equipment. The Bună Ziua team includes a kinetoterapeut, so it
     doesn't look like a staffing gap.
2. *The maternity line looks like a path, not a service.*
   - Prenatal → postpartum evaluation → postpartum recovery (group and individual) → pelvic floor follow one woman over
     months.
   - At Bună Ziua, 10 of 28 timetable classes are this line, all with Cristina Mureșan, including every Tue/Thu 9–11
     slot.
   - **Alternative:** most clients may come for one stage only, which makes it a few short services sharing one
     specialist.
3. *The timetable shows classes; therapy is invisible.*
   - At least four kinetoterapeuți are on the team, and therapy holds the top per-session price (Schroth 220) and
     packages up to 2 160 lei.
   - Yet the only therapy in any timetable is one children's posture class at Decebal.
   - Therapy may be a bigger part of the business than a timetable-led site suggests.
   - **Alternative:** the therapists may be part-time or mostly elsewhere, and therapy small.

**What could change my read.**
- If the location split is about rooms, it's one business with two addresses.
- If most mothers do one stage, maternity is a set of services.
- If therapy is a small share of hours and revenue, the timetable is the business.
- Not naming a stage: two locations and a published timetable fit growing, stable or under-used equally.

**What I need from you.**
1. Last month, split classes / therapy / massage: a) revenue, b) visits. *Tells me whether classes or therapy carry the
   business, the first thing a plan must know.*
2. Is Decebal's narrower offer a choice or a limit? *Tells me whether to plan the locations as one or two.*
3. Of your prenatal clients, roughly how many come back for postpartum recovery? *Tells me whether maternity is a path
   or separate services, which changes how it is offered and measured.*

### Evidence behind each mocked line (all from the BT2 read)
- **Three engines:**
  - prices on `clase-personal-training`, `kinetoterapie`, `masaj`;
  - "Fiecare program începe cu o evaluare atentă" and "Evaluare Kinetoterapeutică … 1 ședință 200 lei" (`kinetoterapie`).
- **H1:**
  - `locatii`: Bună Ziua services = Clase & PT · Prenatală & Postpartum · Masaj; Decebal adds Kinetoterapie;
  - `programari`: Bună Ziua Mon–Thu = 25 entries; Decebal Mon–Thu = 9 (Decebal's Friday is cut in the capture, so only
    Mon–Thu are compared);
  - `locatii/buna-ziua`: "Ioana Urs Kinetoterapeut".
- **H2:**
  - `gimnastica-prenatala-recuperare-postpartum`: the five services;
  - `programari`: 10 of 28 Bună Ziua entries are Gimnastică prenatală / Recuperare Postpartum Grup with Cristina; Tue and
    Thu 09:00, 10:00, 11:00 are all Cristina.
- **H3:**
  - `despre-noi`: Bogdan Borsan (Specialist Kinetoterapeut…), Florin Laza, Andrea Nagy-Demo, Ioana Urs, all
    "Kinetoterapeut";
  - `kinetoterapie`: Schroth 1 ședință 220 lei, Abon. 12 2 160 lei;
  - `programari`: the only therapy entry is "Kinetoterapie posturală (copii 10–15 ani) cu Yvette".

### Product decision this mock forces
**Acquisition** ("where do new clients come from") is strategy-critical and is *not* in the three questions above.
Options:
- **(a)** keep it as a reserved slot: Q3 becomes acquisition and maternity moves to the conversation;
- **(b)** ask it in the conversation step that follows, with the readiness gate unchanged;
- **(c)** allow 4 questions.

My recommendation is **(b)**. Readiness already blocks the strategy until acquisition is known, so nothing is
skipped. The first card spends its scarce questions on forks.

---

## 6. Explicit assessments

**Should "Stage: growth" survive? No.**
- All four reasons are footprint: two locations, a published timetable, many priced services, team size.
- Two are ungrounded numbers ("peste 25 de servicii", "8 specialiști", now dropped on new writes by 3906ad6).
- One is a generic benchmark ("depășește dimensiunea tipică a unui studio în faza de validare").
- One infers volume from a timetable ("volum de activitate real și continuu").
- None is performance evidence. The same footprint fits growing, stable, under-used, contracting or over-extended.
- Fix: rule 4.5. Stage is undetermined and hidden until performance evidence exists. The stored snapshot keeps its old
  label (no mutation), but the read-path rule would also hide it for old snapshots, because the evidence test runs at
  projection too.

**Does the third question's explanation violate epistemic discipline? Yes, on three counts.**
- It predicts the business's state from a hypothetical answer: "venitul este impredictibil".
- It recommends: "structura de prețuri merită reconsiderată".
- It concludes priority: "retenția devine prioritatea principală".
- Per-session payment does not establish unpredictable revenue, because volume can be steady either way.
- It passed because `why` is never gated (§2.5). Q1's "prioritățile… se schimbă complet" is a milder overreach. Q2's
  is generic but not unsupported.
- Fix: 4.4.

**Is the first card showing too much internal inventory? Yes.**
- Eight of nine visible lines are per-dimension extraction, plus a "can't tell yet" list of five dimensions: the
  database BB built, shown as the answer.
- The founder already knows all of it.
- Fix: 4.7. Synthesis first; inventory behind a collapsed "What I read".
