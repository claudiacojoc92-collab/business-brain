# Wave 3 — research adapter path (verified) + market-evidence contract

## Verified production-capable mechanism
Investigation of the repo/runtime found exactly one production-ready public-web capability: the **website
connector** — `fetchDocument()` / `readWebsite()` (`apps/api/src/connectors/website/`). It is robots.txt-
respecting (`fetchRobots` + `isAllowed`), timeout- and size-capped, sends an honest bot User-Agent
(`BusinessBrainBot/0.1 (+…; respects robots.txt)`), and is already used in production for website ingestion.

**No** search provider (SerpAPI/Bing/Google-CSE/Tavily/Brave), **no** LLM web-search/browsing tool, and
**no** research-provider credentials exist in the repo or on the production api service.

## Chosen path — direct public-website retrieval of named entities
Wave 3 retrieves a competitor/alternative/reference's **own public website** via the existing robots-
respecting connector, given a URL. This yields OBSERVED excerpts of *what that entity claims about itself* —
epistemically identical to the founder's own website (business-self claims, NOT market truth). It is
production-ready today, traceable (source URL + retrieval timestamp + extractor version), needs no crawler
and no new provider, and keeps the epistemic discipline intact.

BB may **suggest** likely category/competitors — but, with no search API, those suggestions are **LLM
inferences over the founder's business understanding** (HYPOTHESIS, founder-reviewable), never web-discovered
facts. BB fetches a public site only for an entity the founder adds/confirms (with a URL).

### Rejected alternatives (briefly)
- **Search API (SerpAPI/Bing/Google-CSE/Tavily/Brave):** none configured; needs a paid provider + credentials
  + prod config + legal review. Deferred behind a `ResearchAdapter` interface so it can attach later.
- **Anthropic web_search tool:** not configured; availability/cost/provenance unverified. Deferred.
- **Broad crawler / social scraping / review scraping:** forbidden (access-restricted; and follower counts /
  reviews / search rank do not prove demand, share, or leadership).

## Market-evidence contract (every finding preserves)
`sourceId · sourceUrl · sourceType · retrievedAt · sourceTitle · entityIdentity · observedExcerpt (normalized
observation) · inference (SEPARATE from observation) · epistemicStatus · relevanceToFounder · founderStatus
(pending|confirmed|dismissed) · adapter (e.g. 'website-connector') · extractionVersion`.
Observation and inference are **never** one undifferentiated claim.

## Founder-supplied competitor model
The founder can: add a competitor / alternative / reference brand (name + optional URL); remove a suggestion;
clarify the real category; explain relevance; and mark each entity as **direct | indirect | alternative |
reference**. This path is required even when suggestions are strong.

## Forbidden without sufficient evidence
No claim of demand, market share, audience reaction, conversion, growth, competitive superiority, customer
preference, or brand awareness. Company sites prove self-claims only; search rank ≠ leadership; followers ≠
demand; reviews ≠ the market. Market-facing conclusions stay HYPOTHESIS / NEEDS_MORE_EVIDENCE (same guard as
Wave 2).

## Smallest vertical slice (next)
founder adds one entity (name + URL) → BB fetches its permitted public site via the connector → store the
OBSERVED excerpt and any BB inference **separately**, with full provenance → founder confirms/dismisses
relevance → the confirmed context is available to later orchestration. New tables (market entities +
findings), a `ResearchAdapter` interface (website-connector impl now; search-provider impl later), routes,
founder isolation, export/delete, and tests — engine byte-identical, no crawler, no deploy.
