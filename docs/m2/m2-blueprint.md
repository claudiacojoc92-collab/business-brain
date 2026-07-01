M2 — Connect Your World
Type: Product / Engineering Blueprint Status: DRAFT FOR BUILD — governed by ADR-007 (LOCKED) Date: 1 July 2026 Authored as: Head of Product + CTO Mode: Product & architecture only. No implementation code. ADR-007 not reopened. Business Model engine not redesigned.
Governing principle (frozen, ADR-007): Business Brain learns from connected reality (observed) and declared intent (declared). It never asks founders to reconstruct what it can fetch. Manual reconstruction is permanently forbidden.
This blueprint specifies how connected reality enters the system. It does not touch what the Business Model engine does with evidence once it arrives — that is fixed by ADR-007 as a recompute-on-read function over the evidence store. Everything here stops at the evidence boundary.

1. Product Vision
Why Connect Your World is the true beginning
Manual onboarding asks the founder to be a data-entry clerk for their own business. It is slow, it is undignified, and — the part that actually matters — it produces worse data than the machine could fetch itself. A founder describing their Instagram from memory gives you a lossy, flattering, out-of-date summary. Their actual Instagram gives you the truth, timestamped. Reconstruction doesn't just cost effort; it corrupts the input.
Connect Your World inverts the burden. The founder's job shrinks to granting access and stating intent. Business Brain does the reading. This is strategically superior on four axes:
1. Truth over recall. Observed evidence is what the business actually is, not what the founder remembers it to be.
2. Time-to-value collapses. Authorization takes seconds; reconstruction takes an hour the founder never finishes.
3. Freshness is free. A connected source re-syncs. A pasted description rots the moment it's typed.
4. It compounds. Every connected source and every declared intent adds to a per-founder evidence base that a competitor's fresh signup cannot reproduce. (Retention moat, per ADR-007 §8 — not an acquisition claim.)
The honest tension I'm naming up front
The North Star says "Business Brain reads everything automatically" and then says "I've already analyzed your business." These two sentences are in tension with platform reality, and if we don't resolve it deliberately, we will ship a lie.
Most high-value connectors (Instagram, TikTok, LinkedIn content, X) are gated behind app review, paid access, or partner programs the product does not have on day one. If Connect Your World presents them as live and they return nothing, we have imported the M1 fabrication failure into the connector layer — the exact thing ADR-007 forbids.
The resolution runs through this entire document: the magic moment is built on the one source that reliably returns rich data instantly and with zero gate — the website. Everything else is staged honestly behind real connection states. We promise "already analyzed your business" and keep it, because the website alone can deliver it. We never fake the rest.

2. Founder Journey
Designed as experience, not implementation. Seven beats from signup to Business Model.
Beat 1 — Account. Minimal. Email/OAuth-login, nothing about the business. Onboarding is authorization, not interrogation. No "tell us about your company" form exists anywhere.
Beat 2 — The invitation. A single screen: "Let's connect your world. Point me at where your business already lives, and I'll do the reading." One primary field is pre-focused: the founder's website URL. This is deliberate — the lowest-friction, highest-yield action leads.
Beat 3 — The instant read (website). The founder enters their URL and, within seconds, watches Business Brain visibly working — fetching pages, reading. This is not a spinner. It's a live surfacing of what it's finding. This beat carries the emotional load of the entire product (see §10).
Beat 4 — The source catalog. After the website read lands, Business Brain presents the broader catalog: "I've started. Connect more and I'll understand you deeper." Sources are grouped by how they connect and each shows an honest state (§9). Instagram may say "Connect — I'll begin reading once approved"; upload sources say "Upload and I'll read it now." Nothing claims a capability it doesn't have.
Beat 5 — Declared intent (conversation begins). Business Brain reflects what it observed and then asks the one thing no connector can answer: "Here's what I see. Now — what are you actually trying to do?" The founder's goals, constraints, and fears enter as declared evidence. This is not a form. It is the beginning of the strategic conversation, and it is the moat.
Beat 6 — The Business Model appears. Not built from a questionnaire — recomputed from evidence. The founder sees their business modeled back to them, every claim traceable to something Business Brain actually read or they actually said. Observed and declared, fused.
Beat 7 — Strategic conversation. The model is now the substrate for strategy. The founder is no longer explaining; they are being understood and advised.
The founder never once types what they posted, wrote, or published. They grant, they upload real artifacts, they declare intent. That is the whole journey.

3. Source Catalog
Every source Business Brain should eventually support, with honest 2026 connection reality. Tiers encode build order by truth-cost: T1 = no gate, real data now; T2 = OAuth with light verification; T3 = OAuth behind app review / paid / privacy-heavy; F = future.
Evidence registers (contribution areas) are descriptive — they name which parts of the business a source informs. They map onto the existing Business Model; they do not redefine it.
Source	Method	Auth	2026 legal / access reality	Publishing (future)	Registers	Tier
Website	URL fetch	None	Own site fetch is clean; respect robots.txt/ToS. No gate.	n/a	Identity, Offers, Voice, Cadence	T1
Podcast	RSS URL fetch	None	Podcasts are RSS by design — public feed, no OAuth. Transcripts may need separate handling. Underrated.	n/a	Voice, Offers, Cadence	T1
PDF	Upload	None	Real artifact upload. First-class, not fallback.	n/a	Strategy, Offers, Identity	T1
Word (.docx)	Upload	None	Same as PDF.	n/a	Strategy, Offers, Voice	T1
Google Calendar	API	OAuth	calendar.readonly is sensitive → Google verification + video demo, no CASA.	create events	Cadence/Operations	T2
Google Drive	API	OAuth	Use drive.file + picker (non-sensitive, no CASA). Avoid drive.readonly (restricted → paid CASA audit). Founder picks files.	n/a	Strategy, Offers	T2
Google Docs	API	OAuth	Rides Drive/Docs OAuth. Founder-selected docs only.	n/a	Strategy, Voice	T2
Notion	API	OAuth	Public OAuth integration; reads pages the founder grants. Clean.	write pages	Strategy, Operations, Offers	T2
Dropbox	API	OAuth	OAuth file access, founder-scoped.	n/a	Strategy, Offers, assets	T2
YouTube	Data API	OAuth	Own-channel read; scopes sensitive (verification, no CASA). Quota-metered.	upload video	Voice, Audience, Offers	T2/T3
Microsoft Outlook / 365	Graph API	OAuth	Microsoft Graph (Calendars.Read, files). Enterprise consent nuances.	send/create	Cadence, Network	T2/T3
GitHub (optional)	API	OAuth	Clean OAuth repo/activity read. Only relevant for technical founders.	n/a	Operations, Product	T2
Apple Calendar	.ics / CalDAV	none / creds	No clean third-party OAuth. Practical path: .ics export upload (CalDAV is fiddly, app-specific passwords).	n/a	Cadence	T2 (upload)
Instagram	Graph API	OAuth	Business/Creator only; App Review (Advanced Access) to read founders' accounts; FB Page link for insights. 4–6 wk review.	content publish	Voice, Audience, Cadence, Offers	T3
Facebook	Graph API	OAuth	Page-based; same Meta review regime as Instagram.	page publish	Voice, Audience, Cadence	T3
LinkedIn	Split	OAuth	Identity only self-serve (openid/profile/email). Reading posts is NOT available without Marketing Partner approval (enterprise, $$$). Content → upload (data export). w_member_social enables publish self-serve.	post (self-serve)	Identity, Network; Voice (via upload)	Identity T2 / Content UPLOAD
TikTok	Display API	OAuth	Read own profile/videos via Login Kit + Display API, app review required; tokens 24h/365d. Content Posting API needs separate audit (sandbox = private-only until passed).	video publish	Voice, Audience, Cadence	T3
X (Twitter)	API v2	OAuth	No free tier (2026). Owned-reads $0.001/resource but requires a funded pay-per-use account. Publishing metered ($0.015, $0.20 w/ link).	post (paid)	Voice, Audience, Network	T3 (paid)
Newsletter (Kit/Beehiiv/Substack)	Mixed	OAuth/API/none	Fragmented. Kit & Beehiiv have APIs. Substack has no official API (public archive / RSS → URL fetch or upload). Treat as per-ESP; default to upload/RSS in v1.	some send	Voice, Audience, Cadence	T2 / UPLOAD
Slack	API	OAuth	OAuth read of granted channels. Privacy-heavy (team data, not just founder). Handle with care.	post	Operations, Network, Declared-internal	T3
Discord	API	OAuth + bot	Community read via bot + OAuth. Server-scoped.	post	Community/Audience	T3
Stripe	API	OAuth (Connect)	Restricted-key or Connect OAuth; reads real financial data. High sensitivity.	n/a	Commercial/Financial	F
CRM (HubSpot/Salesforce)	API	OAuth	Per-CRM OAuth; pipeline/contact data.	update	Network/Pipeline	F
Catalog-level challenge: this list is a maintenance liability inventory, not a to-do list. Every connector is a permanent front in an N-front war (versioning, token refresh, breaking changes) run by a very small team. Breadth is the enemy in M2. The catalog exists to show the five-year surface; the MVP touches almost none of it (§11).

4. Connector Architecture
Every connector — website, upload, Instagram, Stripe, anything — implements one contract. This is what makes a source that doesn't exist yet buildable in five years without touching the engine. Per ADR-007: a connector's only output type is Evidence. It cannot write to the model, call the engine, or touch strategy.
The contract (responsibilities, not code):
Method	Responsibility
authorize()	Establish access and hand credentials to the shared OAuth/credential service (§5). For no-auth connectors (website, upload) this is a no-op or a trivial validation. Never stores raw secrets inside the connector.
capabilities()	Declares what this connector can actually do right now — read/insights/publish, and their live status. This is how the UI stays honest about half-connected sources (Instagram-pending returns {read: pending}). Non-optional; it's a product requirement, not a nicety.
sync(cursor)	Pull data incrementally from a watermark. Never a blind full refetch once a cursor exists. Returns raw provider payloads.
normalize()	Transform provider-specific shapes into the canonical internal shape. The one place provider weirdness is allowed to live.
produceEvidence()	Convert canonical data into typed evidence fragments with full provenance (§5 schema in ADR-007). The only method that emits into the store.
status()	Report live connection state (§9): live / stale / revoked / empty / failed / permission-required. Drives honest UI.
disconnect()	Clean teardown and credential deletion. Revocation is a first-class operation, not an afterthought (GDPR + trust).
The inviolable boundary: connectors emit evidence and nothing else. No connector may reach past the evidence store toward the model. This decoupling is the whole architecture. Break it once and the five-year design collapses into spaghetti by connector #4.
Do not build a plugin SDK yet (ADR-007 deferred). This is a convention plus an abstract base, extracted from real connectors — not a framework designed against imagined ones. The SDK gets extracted from connector #3, never before.

5. OAuth Infrastructure
OAuth is shared infrastructure, provider-agnostic, built once. It is not re-implemented per connector. Every OAuth source (Google, Meta, TikTok, X, Notion, Microsoft, LinkedIn, Slack…) plugs into the same credential service.
Responsibilities of the shared layer:
* Authorization — a uniform authorization-code/PKCE flow orchestrator, parameterized per provider (endpoints, scopes, redirect). Providers differ only in config, not in code path.
* Credential storage — encrypted at rest, server-side only, never client-exposed (Meta, X, TikTok all require this). Per-founder, per-provider token records.
* Refresh — a managed lifecycle worker, not a request-time surprise. Tokens expire on wildly different cadences (Meta ~60d, TikTok 24h access / 365d refresh, LinkedIn 60d, X per-account). The layer refreshes ahead of expiry and surfaces failures as connection-state changes, not silent breakage.
* Revocation — handle both founder-initiated disconnect and provider-side revocation. A revoked token flips the connector to revoked state honestly; the model stops trusting that source's evidence.
* Permissions / scopes — least-privilege by default (ADR-007 forbids over-scoping; it's also the top cause of app-review rejection). Scopes declared per provider, requested minimally, upgraded only when a validated feature needs them.
* Security — encryption, audit logging of every credential use, and per-founder key isolation (this is also the GDPR crypto-shred hook from ADR-007 §risks).
* Provider abstraction — a provider is a config object (auth URLs, token URLs, scope sets, refresh semantics). Adding a provider is adding config + a connector, not rebuilding auth.
* Future write permissions — the layer is designed from day one to hold read scopes now and publish scopes later for the same provider, without re-architecture. Publishing itself is out of scope for M2 (ADR-007), but the credential service must not have to be rebuilt to support it. Read and write are the same token lifecycle with different scopes.
Design assertion: if OAuth is built per-provider instead of as shared infrastructure, the connector count becomes the bug count. Build the abstraction with the second OAuth provider (Google → then Meta proves the abstraction). Don't over-abstract on the first.

6. Website Connector
The first connector, and the most important, because it carries the magic moment and needs no OAuth.
What it reads (own site, no auth):
* Homepage — the positioning claim, the hero promise, the primary CTA. Highest-signal single page for "what does this business say it is."
* About — origin, founder identity, mission language, team. Feeds Identity register.
* Services / Products / Pricing — the actual offers, structure, and price posture. Feeds Offers register.
* Landing pages — campaign-specific promises and target segments; reveals what the founder actively sells and to whom.
* Blog / articles — voice, topics, cadence, expertise claims. Feeds Voice + Cadence.
* Metadata — title tags, meta descriptions, Open Graph, schema.org markup, sitemap. Cheap, structured, high-yield signal about how the business frames itself.
* Internal link graph — the site's own structure reveals what the business considers important (what's linked from the nav, what's buried). Structure is signal.
How it works, conceptually: fetch the entry URL, parse structure and metadata, discover internal links, fetch the meaningful pages (bounded — not a full crawl of everything), extract text and structured data, normalize, and produceEvidence() as observed fragments each carrying source_url, occurred_at/captured_at, and visibility: public. Every fragment traces to the page it came from.
Honest boundaries: respect robots.txt and ToS. This connector reads the founder's own site they point us at — not arbitrary scraping of third parties (forbidden, ADR-007). Bound the fetch (page count, depth, timeout) so a large site doesn't hang the magic moment. If a page fails, that's a visible gap, never a fabricated read.
Why it's first: zero gate, rich data, instant, and it's the only source that can make Beat 3 land on day one. It is the wedge for the entire product.

7. Upload Connector
Uploads are first-class citizens, not fallbacks. Some of the highest-value evidence cannot be connected legally or technically and only arrives by upload — and treating that as second-class would be a product error.
What arrives by upload:
* LinkedIn data export — the only honest way to read a founder's LinkedIn content (§3; official read is partner-gated).
* PDF — strategy docs, brand guidelines, pitch decks, offer sheets.
* Word / docx — the same class of real business artifacts.
* Google/Notion exports — when a founder would rather hand over an export than OAuth-connect.
* ZIP archives — bulk artifacts; unpack and treat each contained file as its own evidence source.
* .ics calendar exports — the practical Apple Calendar path.
The rule: everything uploaded becomes evidence, typed and provenance-bearing like any other source. An uploaded real artifact is observed (it's a genuine business document, not the founder retyping one). The critical distinction ADR-007 freezes: uploading a real document you already have = allowed; retyping/summarizing content that lives somewhere connectable = forbidden reconstruction. The upload connector reads artifacts; it must never become a disguised paste box.
Conceptually: accept file, detect type, route to the right extractor (PDF text, docx text, ZIP unpack-and-recurse, .ics parse), normalize, produceEvidence() with source: upload, original filename, and captured_at. occurred_at comes from document metadata where available, else null (honest about not knowing).

8. Evidence Pipeline
The full path, and the one rule that governs it.


Connectors (observed)  ─┐
Uploads    (observed)  ─┼──▶  Evidence  ──▶  Evidence Store  ──▶  Business Model  ──▶  Conversation
Conversation (declared) ┘        (typed        (append-only,        (recompute-           │
                                 fragments)     provenance)          on-read)         Recommendations
                                                                                          │
                                                                                     Publishing (future)
The governing rule (ADR-007): the Business Model engine never communicates directly with connectors. It consumes only evidence. It does not know Instagram exists. It knows only that typed, sourced fragments are in the store. This means:
* A connector can break, change, or be added with zero engine changes.
* Every belief in the model traces to fragments; a belief with no evidence is invalid by construction.
* observed, declared, inferred flow through the same pipe with different confidence_kind; the engine fuses rather than averages them.
* inferred fragments without derived_from are schema-invalid — fabrication is unrepresentable (the M1 fix, structural).
Conversation is bidirectional in this diagram on purpose: it reads the model (to reflect understanding) and writes declared evidence back into the store (capturing intent). It is both an output surface and an input source. That duality is the moat.
Publishing sits at the end, greyed: out of scope for M2, present in the diagram only so the pipeline's shape is honest about where it eventually leads. No write-back is built now.

9. Connection States
Every connector exposes honest state. Never fake a successful read. This is the connector-layer expression of the honesty principle — the single most important non-negotiable in the whole milestone.
State	Meaning	Founder-facing honesty
Available	Can be connected; not yet connected.	"Connect this."
Connecting	Auth/fetch in flight.	Live progress, not a fake spinner.
Authorized	Access granted; first read not yet complete.	"Connected — starting to read."
Reading	Actively pulling data.	Shows what it's finding.
Synced	Read complete; evidence in store; timestamped.	"Read N items just now."
Outdated	Previously synced; data may be stale.	"Last read 6 days ago — refresh?"
Permission Required	Connected but scope/app-review insufficient to read.	"Approved soon — I'll begin once access clears." (Instagram-pending)
Revoked	Access withdrawn (founder or provider).	"Access ended — reconnect to resume." Model stops trusting this source.
Failed	Attempt errored.	Honest error + retry. Never silently degrade to a guess.
Empty	Connected, read succeeded, nothing returned.	"Connected, but I found nothing here." Contributes no evidence.
The Empty state is the whole point. A source that connects but returns nothing must contribute nothing to the model — never a plausible-looking fabricated read. Empty and Failed are features, not embarrassments; they are how Business Brain stays trustworthy when a platform gives it nothing.

10. The First Magic Moment
The emotional North Star. The most important 30 seconds in the product.
The setup. The founder has just entered their website URL. They expect a spinner and a form. Instead:
Seconds 0–5. Business Brain visibly goes to work — not a loading bar, but live evidence of reading: "Reading your homepage… found your About page… reading your services… seeing your blog…" The founder watches it move through their own site. The feeling: it's actually looking.
Seconds 5–20. It starts reflecting back things the founder never typed. Not a data dump — recognition. "You position yourself as [the actual positioning from their hero]. Your core offer looks like [the real service structure]. Your voice is [the actual register — direct, warm, technical, whatever it genuinely is]. You've been publishing about [the real recurring themes]." Each line is something true, specific, and unasked-for.
Seconds 20–30. The turn. Having proven it sees, it asks the one thing it can't know: "That's what I can see from the outside. Now tell me what I can't see — what are you actually trying to build?" The founder feels met, and the conversation (declared intent, the moat) begins.
The target thought, verbatim: "How the hell does it already know all this about my business?"
Why it works and why it's honest. It works because the founder is seeing themselves reflected with specificity they associate with being understood by a person, delivered in seconds, for the price of a URL. It's honest because every single line traces to something Business Brain actually read — no fabrication, all observed, all provenance-bearing. The magic is not an illusion; it's the truth, delivered fast.
The design constraint this imposes on everything else: the magic moment must be carried by the website connector alone, because it's the only source with no gate. We do not stake the first impression on Instagram or any app-review-gated source — those will be Permission Required on day one and would turn the magic into a broken promise. The website makes the promise keepable. Protect this. It is the product thesis in fifteen seconds, and it is buildable now.

11. MVP Recommendation
The smallest technically honest Connect Your World that delivers real founder value:
Ship first (v0):
1. Website connector — the magic moment, no gate. This alone justifies the release.
2. Upload connector — PDF, docx, ZIP, .ics, LinkedIn export. First-class, real artifacts, no gate.
3. Conversation → declared-intent capture — the moat, and cheap (same store, different confidence_kind).
4. Evidence store + recompute-on-read Business Model — per ADR-007, already the approved nucleus.
5. Honest connection states — even with two live connectors, the state machine ships now.
Start in parallel, ship when ready: 6. Google (Calendar readonly + Drive drive.file picker) — OAuth proves the shared credential layer with a low-friction, no-CASA provider. Good first OAuth. 7. Instagram App Review submission — submit day one; the 4–6 week clock is the binding constraint on the flagship connector. Build the connector against the approved scopes only after review clears. Do not block v0 on it.
Explicitly wait:
* TikTok, X, Facebook, LinkedIn content-read, Slack, Discord, Notion, Dropbox, Microsoft, YouTube — every T3 and most T2. Each is a maintenance front and an app-review or paid gate. Pulled in only when a real founder's business actually lives there and demand is demonstrated (ADR-007 deferral discipline).
* All publishing / write-back (ADR-007 forbidden until read-side trust is earned).
* Full orchestration, incremental sync, webhooks, plugin SDK, relational graph (ADR-007 deferred).
Why this order: it maximizes speed-to-real-value. Website + upload delivers the magic moment and a genuine Business Model on day one with zero external gate — nothing between the team and a founder saying "how does it know." Google validates the OAuth abstraction cheaply. Instagram's clock runs in the background so the flagship connector lands as soon as it legally can. Every heavy source waits for proof of need. This is the honest nucleus made shippable.

12. Risks (attacking our own proposal)
Technical risks.
* Website parsing is deceptively hard. Sites vary wildly — SPAs that render client-side, thin one-pagers, sprawling sites, paywalls, anti-bot measures. The magic moment depends on the least standardized source on the internet. Mitigation: bound scope (key pages, not full crawl), degrade honestly (Empty/partial, never fabricate), and treat a thin-site founder as a prompt to lead with upload instead.
* Silent evidence corruption. A connector returning plausible-but-wrong data (stale cache, mis-mapped field) poisons the model with confident falsehood — worse than an error. Mitigation: provenance on every fragment, validation at normalize(), and preferring Empty over uncertain reads.
* Token-lifecycle sprawl. Every OAuth provider expires differently; refresh bugs surface as silent data staleness. Mitigation: the shared credential layer owns refresh as a managed lifecycle (§5); expiry becomes an honest Outdated/Revoked state, never a silent gap.
Product risks.
* Cold-start emptiness. A founder who connects only one thin source gets a shallow model — and the promise "I've analyzed your business" underwhelms at the exact moment of first impression. Mitigation: website-first (richest no-gate source); if the site is thin, immediately route to upload; never let the first screen resolve to "I found almost nothing."
* The magic moment misses and inverts. If Business Brain reflects back something subtly wrong, "how does it know" becomes "it doesn't get me," and trust is spent. Mitigation: specificity with humility — reflect what's clearly supported, hedge what's thin, and let the founder correct (corrections are high-value declared evidence, not failures).
* Declared intent doesn't get elicited. The moat depends on founders articulating goals/fears — many won't, on demand. Mitigation: the conversation must make declaration feel like relief ("finally, something that gets me") not homework; and we accept that the observed layer must stand alone as valuable even if declaration is sparse.
Platform risks.
* App review is a gate we don't control. Meta/TikTok can delay, reject, or revoke. A roadmap staking the flagship on Instagram approval is hostage to a queue. Mitigation: the entire v0 (website + upload + Google) is designed to deliver value with no app-review dependency; Instagram is upside, not critical path.
* Platforms change terms overnight. X killed its free tier; Meta versions quarterly; LinkedIn closed partner onboarding. Any connector can become uneconomic or impossible with a policy change. Mitigation: the connector boundary (§4) isolates blast radius to one connector; the engine never depends on any single source; breadth is deferred so we carry fewer hostages.
OAuth risks.
* Credential compromise is catastrophic — we'd hold read tokens to founders' entire digital lives. Mitigation: server-side-only storage, encryption, per-founder key isolation, audit logging, least-privilege scopes, and honest disconnect/erasure. This is also why publishing scopes are deferred — read tokens are dangerous enough before we add write.
* Google CASA / scope-creep cost. Reaching for broad Drive read triggers a paid annual security audit. Mitigation: drive.file + picker in v0, full-Drive read forbidden until a validated feature demands it (ADR-007).
Maintenance risks.
* The N-front war. Each connector decays without being touched; N connectors = permanent N-front maintenance for a tiny team. Mitigation: the catalog is not the roadmap; MVP carries ~2 live connectors; every addition must be demand-pulled. Breadth is explicitly the enemy in M2.
Cold-start risks (the meta-risk).
* We perfect the retention machine for a product no one has adopted. ADR-007's own warning: the graph is retention, not acquisition. The gravest risk is over-investing in evidence infrastructure while the first-moment (§10) — the thing that actually drives adoption — goes under-polished. Mitigation: the MVP is deliberately tiny on infrastructure and disproportionately invested in the website magic moment. If forced to choose where the next hour goes, it goes to making the first 30 seconds uncanny — not to connector #3.

Closing assertion (as CTO + Head of Product)
The honest version of "Connect Your World" is not "connect everything automatically." It is: connect the one source with no gate, make it feel like magic in thirty seconds, capture intent in the conversation that follows, and stage everything else behind states that never lie. That version is buildable now, defensible over five years, and consistent with every lock in ADR-007.
The single thing I'd protect above all others: the website magic moment. It is the whole thesis, it needs no one's permission, and it is the only part of this milestone that turns a data-integration product into something a founder falls in love with in the first minute.

Governed by ADR-007 (LOCKED). Business Model engine unchanged. No reconstruction. Product & architecture only.
