# Intent: the move arrives written — landing page first

- **Date:** 2026-10-05
- **Originator:** Claudia (product owner)
- **Approved by:** Claudia on 2026-10-05
- **Status:** approved

## Problem

Today a move is an instruction the founder carries out — BB knows the answer and hands the
founder the question. The clearest case is the site-audit / "write the landing page content"
move: BB has already read the business, holds the strategy, and knows what the page should say,
yet it tells the founder to go write it. People pay for something done, not advised. The landing
page is the asset the whole strategy depends on and the one the constraints say doesn't exist.

## Outcome

A founder opens the app and the landing-page move has arrived **written** — a real, structured
first version of their page copy, grounded in their held strategy, their voice, and only facts
BB is licensed to state. They read it, edit any section, and accept it. When BB cannot produce
safe copy, the move degrades to today's plain instruction — never unsafe copy.

**Observable check:** on Body Move (a real medical-recovery business, Romanian), the surfaced
landing move shows a multi-section draft that passes the claim-safety + medical gate; an
adversarial attempt to make it assert a regulated therapeutic claim (treats / cures / recovery
rate) fails closed; the founder can edit and accept, and the accepted copy is exportable.

## Affected users and systems

Founders on Today/Create. New: a landing prose generator (application port + infrastructure
adapter), a `MoveDraft` storage table + repo, a medical/regulated-claim gate, a BullMQ
draft-on-surface job, API routes, and the Today draft surface (`apps/web/src/slice0`). Reuses the
frozen Slice-4 proposition kernel, the authorization/proof substrate, and the reel async pattern.

## Constraints

- **Claim-safety is not optional and not where we economise.** BB will write public copy for a
  medical recovery business. All generated prose routes through the frozen proposition kernel
  plus a new medical guard; fail-closed = nothing shown.
- **Frozen Slice-4 touch, approved:** extend `SampleChannel` with `'landing'` under `approve
  frozen` (and its voice repository/DB). We do NOT reuse `'caption'` — a landing page recorded as
  a caption is a lie in the data model that every future query and safety trace would inherit.
- Env-key preflight before any api restart; no push without approval; new migration needs
  `approve migration`.

## Out of scope

- Deploying the landing page itself — BB produces the copy; the founder deploys it elsewhere.
- The message move and carousel/reel moves — built later on the same `MoveDraft` shape (see plan §5).
- The door-question attribution feature (withdrawn, see canggu-build-plan).
- Instagram-as-first-session, the visible onboarding boundary, and where new material comes from —
  recorded as still-open in canggu-build-plan, not part of this build.

## Open questions

- None blocking. (Channel decision and persistence both answered 2026-10-05.)
