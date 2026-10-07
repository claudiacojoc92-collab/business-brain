# Intent: license the business's verifiable atoms into the shared fact substrate

- **Date:** 2026-10-06
- **Originator:** Claudia (product owner)
- **Approved by:** Claudia on 2026-10-06
- **Status:** approved

## Problem

The licensed-fact substrate that every asset generator reads (`carouselContext` in the composition
root — carousel, reel, reel-shoot, and the pending move-draft) is fed by two site-derived paths, and
for a non-English business **both are effectively inert**:

- **Path 1 — understanding synthesis** (`allowedBusinessFacts` over the LLM `GovernedUnderstanding`)
  yields only *interpretive summaries* (offer summary, positioning, themes). `GovernedUnderstanding`
  is an interpretation schema; it has **no slot** for operational atoms.
- **Path 2 — proof extraction** is **English-coupled in code**: `BIZ_REF_RE` is English-only and the
  `wrap()` reported-speech templates are English, so Romanian/Italian site facts fail the
  about-business guard and are dropped.
- The deterministic facet layer (V052/V053) is an unwired English regex catalog with no diacritic
  folding, and does not feed the substrate anyway.

Net effect (recorded in `docs/operations/known-issues.md` as a **shipped-feature defect**): for a
Romanian or Italian business, the substrate contains only LLM-authored summaries plus founder
conversation input — **zero concrete, verifiable facts about the business.** Carousel and reel are in
production on that substrate today. Measured on the real Body Move site, the four service names and
the two Cluj addresses are nowhere in the licensed set, and the landing generator — starved — reaches
for positioning and is correctly blocked by the kernel. The gate is not too strict; the substrate is
starved.

## Outcome

A separate, **language-neutral atom extractor** (a sibling to proof extraction) reads the ingested
fragments a business already has, and licenses its **verifiable operational atoms** — service names,
addresses, hours/session length, contact & booking, people/roles, prices — as provenance-carrying
`business_evidence` propositions into the one shared substrate. Carousel, reel, and move-draft all
inherit them. An atom is licensed **only if its value appears verbatim in an ingested fragment**, with
a stored pointer to that fragment (source URL + fragment id + exact span) — so the mechanism is
language-agnostic by construction and directly testable.

Two production repairs ship alongside, because they affect live content now: de-anglicizing proof
extraction (RO/IT), and a numeric sanity bound on checkable proof.

**Observable check (the acceptance test):** ingest `bodymovestudio.ro`; the extractor licenses the
four service names (Clase & Personal Training; Kinetoterapie; Gimnastică Prenatală & Recuperare
Postpartum; Masaj) and both addresses (Strada Decebal nr. 110; Strada Nicolae Tonitza nr. 2A, Cartier
Bună Ziua), **each with a verbatim source pointer**. (Network note: this host refuses connections from
the build network — tested via a saved-fetch fixture or operator-supplied page content; see the plan.)

## Affected users and systems

Every asset generator, for every non-English business, immediately (carousel + reel in production).
New: an atom-extraction application service + ports, an `AnthropicAtomModel` adapter, a
`workspace.business_atom` store (V083) + repo, and one additive read in `carouselContext`. Repairs
touch `packages/application/src/proof/proof-extraction.service.ts`. **No frozen-slice code is
modified** (see Constraints), but the frozen carousel/reel generators will begin receiving real facts,
so their output changes and must be re-verified.

## Constraints

- **Safety is verbatim anchoring, not pattern matching.** No regex language gates, no English
  reference guard, no English wrap templates. An atom is licensed only when it is a verbatim span of a
  real fragment, with a stored pointer. Diacritic folding wherever any normalization happens, and only
  for *matching* — the licensed value keeps its original diacritics.
- **Closed scope — six atom classes only.** Not an open-ended fact extractor: services, locations,
  schedule, contact & booking, people, prices. Anything else is out of scope and stays with the
  interpretive paths or proof extraction.
- **Do NOT extend `GovernedUnderstanding`.** It is an interpretation schema (revisable claims about
  meaning); atoms are verifiable facts that must be re-extractable without re-running interpretation,
  and must keep per-atom provenance. Atoms live in their own store, like proof facts.
- **Atoms are facts, not proof.** They license as `business_evidence` (what the business *is/offers*),
  never as `behavior_result` proof (documented outcomes). A price or an address is not a result.
- **One substrate.** Atoms enter at `carouselContext` so all generators inherit them; no per-generator
  fact plumbing.
- **Frozen slices:** none edited. Slice 6/6.1 carousel and Slice 7 reel *code* is untouched; the
  change is upstream, in the asset-authority region (above `WALL-END:asset-authority`). The behavioural
  consequence — richer licensed facts → different carousel/reel copy — is intended and will be
  re-verified on a real business before this is called done.

## Non-goals

- Not touching the understanding prompt or schema.
- Not wiring or removing the dead V052/V053 facet pipeline.
- Not the move-draft wiring itself — that follows, once atoms make its acceptance test passable.
- Not an open-ended structured-data extractor; the six classes are the whole surface.
