# Spec: Result Loop V1 (referral acquisition)

- **Intent:** ./intent.md · **Plan:** ./plan.md
- **Decisions marked (D#) are proposed defaults awaiting operator confirmation.**

## 1. Product

**Where it lives (no new page).**
- **Strategy page, under the bet:** "Who can send them": the contacts this strategy works through (name,
  organisation, role, status, last touch, next follow-up). Add a contact here (D3).
- **Today:** the strategic execution surface stays. Due follow-ups appear as the move ("Follow up with Dr X today"),
  plus one result line ("3 clinics have not answered. No change to strategy yet." / "Referral responses are below the
  condition you set. The strategy needs review."). Today is not a contact list.
- **Message composer (drawer):** opened from a due follow-up or a contact: shows the brief in plain words (to, why
  now, the one ask), the email, edit, "I sent it" (logs the touch). A small "How you write" block: paste an email you
  wrote, phrases you'd never say, greeting / sign-off / length.
- **Report what happened (Today):** founder writes free text → BB shows what it understood (touches, outcomes,
  follow-ups, per contact) → founder confirms → written as typed state, the original sentence kept as evidence (D4)
  → evaluator → verdict.

**Verdict semantics.** STILL_HOLDS = nothing to change (informational); TUNE = strategy holds, execution changes
(new/changed follow-ups); REVISE = evidence argues for a different strategy (enough cumulative evidence, no explicit
condition met); RECONSIDER = an explicit reconsider condition is materially met by the counts.

**Today impact is one canonical fact.** Either Today changed (show the new move + why) or it did not (say so). Never both.

## 2. Data (new schema `result`, migration V085: needs `approve migration`)

| Table | Purpose | Mutability |
|---|---|---|
| `result.contact` | id, business_id, type ORGANISATION\|PERSON, name, organisation_name, role, email, phone, website, source (jsonb: kind + quote/url), status TARGET\|CONTACTED\|IN_CONVERSATION\|PARTNER\|NOT_INTERESTED\|NEEDS_DETAILS, created_at, updated_at | status + contact details updatable (current state); history lives in touch/outcome |
| `result.touch` | id, business_id, contact_id, action_ref, channel EMAIL\|PHONE\|WHATSAPP\|VISIT\|OTHER, direction OUTBOUND\|INBOUND, type SENT\|VISITED\|REPLIED\|FOLLOW_UP\|NOTE, occurred_at, summary, source (jsonb), created_by BB\|FOUNDER\|SYSTEM, created_at | append-only (no UPDATE/DELETE in the repository) |
| `result.outcome` | id, business_id, contact_id, touch_id, outcome_type NO_RESPONSE\|NOT_INTERESTED\|MATERIAL_REQUESTED\|FOLLOW_UP_REQUESTED\|MEETING_REQUESTED\|REFERRAL_RECEIVED\|CONVERTED\|OTHER, stage, occurred_at, note, evidence (jsonb: original statement + quote), created_by | append-only |
| `result.follow_up` | id, business_id, contact_id, what, reason, due_on, status OPEN\|DONE\|CANCELLED, created_from (outcome/touch id), resolved_by_touch_id, resolved_at | status resolves once; never deleted |
| `result.writing_entry` | id, business_id, kind SAMPLE\|ACCEPTED_PHRASE\|REJECTED_PHRASE\|NEVER_SAY\|PREFERENCE\|SENDER, text, key, created_at | append-only; the profile is a projection (latest per key) |

**Follow-ups are not plan actions (D5).** Plan actions are immutable per month plan version and superseded each cycle;
a contact's next touch outlives a plan. Follow-ups are contact-level obligations read by the SAME Today projection
(not a second task UI). A follow-up resolves when a later touch to that contact is logged.

**No outcome ever becomes founder_state.** `outcome_report` input never writes a founder_state row (fixes the
constraint/correction misfiling). Outcomes live only in `result.*`.

## 3. Technical

- **Application module `packages/application/src/result-loop/`:** contracts + ports (contact, touch, outcome,
  follow-up, writing repositories), `ResultLoopService` (add/update contact, log touch, record outcome, open/resolve
  follow-ups, project per-contact state, cumulative stats), `parseResultReport` (model proposes, deterministic check:
  every item carries a quote that is in the statement; counts must be stated), in-memory repos for tests.
- **Impact (extended, not replaced):** `ImpactAssessInput.cumulative` = deterministic stats (contacts by status,
  touches by type, outcomes by type, response rate, referrals, first/last dates). Reconsider conditions are structured
  once per evaluation by the model into checks over those stats ({metric, comparator, threshold, minSample} or "not
  measurable"), then evaluated deterministically. RECONSIDER only when a check is met; REVISE only with model
  "strategic" AND a minimum sample (else downgraded with "too early to change the strategy"); TUNE when follow-ups
  were opened/changed; else STILL_HOLDS. Today impact = deterministic diff of Today's due list before/after the write.
- **Verdict UI:** `todayImpactView()` single interpretation; `verdict.holds` no longer says "Today is unchanged".
- **Communication:** `packages/application/src/communication/`:
  1. `buildBrief()`: sender_identity, recipient_identity, recipient_role, relationship_context (from touches),
     why_now (due follow-up reason / Today move), strategic_reason (bet + referrer role), desired_outcome + CTA (by
     purpose: first outreach / material follow-up / no-response follow-up), offer_or_value (offer memory or
     understanding offer), supporting_context (founder-said facts + licensed business facts, ranked), what_not_to_say
     (constraints + never-say + no invented numbers), tone/length (writing profile or conservative default), language
     (content language), channel. Validated before any prose (required fields, recipient reachable on the channel).
  2. `AnthropicMessageModel.write(brief, writingProfile)`: prose from the brief only (no strategy dump).
  3. Sendability gate: deterministic checks (length, placeholders, invented numbers, corporate/fake-warmth phrase
     lists in en/ro/it/de, greeting/sign-off rules, one question, recipient named, sender signed) + a model judge on
     the 10 questions (verdict + reasons). Fail → repair with the reasons (max 2) → still failing → shown as "BB
     couldn't write one it would send" with the reasons, never a bad email.
- **Founder writing voice:** `result.writing_entry` projection → {sender, samples, accepted, rejected, neverSay,
  greeting, signOff, length, directness, warmth}. No samples → conservative defaults (short, plain, no fake warmth, no
  "I hope this finds you well"). The edited version the founder actually sends is stored as a SAMPLE. Never inferred
  personality; only observable preferences and explicit corrections. Slice 4 Voice is not touched.
- **Email wiring:** the arc email moment keeps working but its `todaysMove` becomes Today's selected move (not
  `actions[0]`). The new composer uses the brief path.
- **API:** `result.routes.ts`: contacts CRUD-lite, touches (POST only), follow-ups (list/resolve), report parse +
  confirm, message brief + draft + sent, writing profile entries. Today projection adds `due` + `resultLine`.
- **Execution write-back:** "I sent it" → SENT touch (created_by FOUNDER, source = the message id) + resolves the open
  follow-up; reported touches/outcomes via confirm.

## 4. Design
Existing Today and Strategy grammar; no new card type. Composer = drawer like Talk / Add Context.

## 5. Acceptance (Body Move)
Contacts: a clinic, an orthopaedic doctor, a neurologist, a physio partner. Strategy → contact → next move → brief →
sendable email → "I sent it" → report ("visited five clinics, two not interested, two asked for the brochure by
email, one doctor wants a follow-up") → typed state → evaluator → Today changes only if justified. Three emails: first
outreach, follow-up after material requested, follow-up after no response. Live runs = operator script (real models)
+ local UI walk; production only after review.

## Open decisions (operator)
- D1 Migration V085 (schema `result`, 5 tables). Needs `approve migration`.
- D2 Sender per business (name + role, default = account name; Body Move = Raluca).
- D3 Contacts live on the Strategy page under the bet + Today due moves; no new page.
- D4 Report → BB shows what it understood → founder confirms → write.
- D5 Follow-ups are contact-level rows read by Today, not plan actions.
