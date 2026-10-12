# Conversation cap: 3 questions, then goal confirm, then strategy (2026-10-12)

Operator bug report: in prod (QuFi Network) the conversation kept asking (5+ turns, "never-ending story").
Operator spec: turns 1–3 strategic questions; turn 4 = one-click "Is this your goal? [your words]" (confirm or
correct → strategy); nothing goal-shaped → strategy on an ASSUMED goal (the named constraint), flagged on the card.
Plus: the understanding opened half-way down after pour-in "Done".

Local end-to-end, 3 runs: real conversation + strategy models over in-memory stores, QuFi understanding + site
pages; the founder is simulated by a model answering as the QuFi founder (persona in the harness). The harness
auto-confirms the goal candidate (a real founder can edit it).

```
========================= RUN a
CONSTRAINT: No customer has used QuFi and got a result, so every claim about the network — its performance, its pipeline, its products — is unanchored.
[BB (opener)] I have read what you gave me — here is what stands out about QuFi Network before we talk.
You have built a protocol story ten pages deep, but the three products a buyer would actually sign for get one paragraph each — the depth is inverted relative to where a sale happens.
You claim 200+ organisations in pipeline across 50+ countries with zero named partners, logos or pilots — that gap is the first thing an enterprise compliance team will notice.
Post-quantum urgency is your entire entry argument, but the site never shows the network running — so the threat feels real and the solution feels theoretical at the same time.
Whether any part of QuFi is live, in testnet, or still in design — the site cannot answer this, and it changes everything about what the strategy optimises for.
What is actually built and running today?
[Founder (answer 1)] The core verification protocol is running on a private testnet, and we're in active pilot discussions with two banks to move that into a live environment.
[BB] Private testnet running, two banks in pilot discussions — that is a real foundation, and it changes the read significantly. But 'pilot discussions' and 'pilot' are different things: one is a conversation, the other is a commitment. The distance between those two is exactly where enterprise deals stall — and right now your site is written as if the network is already at scale, which creates a credibility gap the moment a bank's technical team looks closer.

Of the two banks — are they evaluating QuVault, QuSettle, or the verification layer itself, and has either one defined a specific condition they need verified before they will move forward?
[Founder (answer 2)] Both banks are evaluating the verification layer directly, and yes, one of them has given us a specific technical condition we're working against right now.
[BB] One bank has handed you a specific technical condition — that is not a discussion anymore, that is a spec. Which means you are already in the product phase of a sale, not the marketing phase. Got it.

Are QuVault, QuSettle, or QuFi Verify available to access, trial, or integrate in any form today — or is the only live entry point the verification layer itself on the private testnet?
[Founder (answer 3)] QuFi Verify is accessible on the private testnet, and that's the live entry point we're working with for the bank pilots right now. QuVault and QuSettle are roadmap products — they're not available to trial or integrate today.
[BB] Summary:
• QuFi Verify is the only live product — QuVault and QuSettle are roadmap, not market.
• Your site presents all three as equally real; that is a credibility liability, not a positioning choice.
• One bank has given you a technical spec — you are in a product engagement, not a sales conversation.
• The 200+ pipeline claim sits on top of a private testnet with zero public proof — the gap between those two is the core strategic tension.

Diagnostic: QuFi Verify is your entire business right now, but your site buries it under two products that don't exist yet and a protocol story that reads like a whitepaper — so the one thing that could close a bank deal is the hardest thing to find.
GOAL STEP: confirm shown: "Both banks are evaluating the verification layer directly, not a specific named product" → founder confirms
STRATEGY: proposal | bet: Make QuFi Verify on the private testnet the visible, credible center of everything you show the two banks right now | over: Presenting QuVault and QuSettle as part of the current offer | horizon: Now through live bank deployment | assumed: None
answers: 3 | BB questions after the opener: 2

========================= RUN b
CONSTRAINT: No customer has used QuFi and got a result, so every claim about the network — its performance, its pipeline, its products — is unanchored.
[BB (opener)] I have read everything you gave me on QuFi Network — here is what stands out before we talk.
You have built a fully specified network on paper — performance targets, node counts, finality times — but no buyer can yet touch, trial, or integrate any of it; the gap between the specification and the product is the entire sales problem right now.
QuVault, QuSettle and QuFi Verify are named and positioned as distinct products, yet each gets one paragraph and no access path — the architecture is ten pages deep, the products are invisible; you are marketing the engine, not the car.
You claim 200+ organisations in pipeline across 50+ countries with zero named partners, logos, or pilots — that number either builds enormous credibility or collapses it entirely, depending on what is actually behind it.
Whether any part of the network is live, in testnet, or still entirely in design — nothing on the site answers this, and it changes everything about what the strategy needs to do.
What is actually running today — and what is not yet?
[Founder (answer 1)] The core verification logic is running on a private testnet, so the cryptography works and we can demonstrate it to a counterparty under NDA. The three products are real but not yet customer-accessible — no self-serve trial, no integration sandbox. That's the gap we're focused on closing with our first bank pilot.
[BB] Private testnet plus NDA demo is a real proof point — but it means every conversation you have right now is a trust exercise, not a product trial. The bank pilot is doing the work that a sandbox would normally do, which makes it load-bearing in a way most pilots are not.

Who is the bank — is it a signed commitment with a defined scope, or a warm conversation you are still trying to close?
[Founder (answer 2)] Two banks are in active discussions, but neither is signed yet — these are still conversations we're working to close. That's exactly why the next six months are laser-focused on getting one of them across the line.
[BB] Two warm banks, no signature yet — which means the business is currently running entirely on narrative, not evidence. That is not a criticism; it is the structural reality of where you are. But it sharpens the question: what is actually moving these conversations forward right now, and what is stalling them?

What does the bank ask for that you cannot yet give them — the thing that keeps the conversation from becoming a signed scope?
[Founder (answer 3)] The clearest blocker is a live production reference — they want to see another regulated institution that has already run this in a real settlement workflow, not a testnet. That's the circular problem every first-mover faces. What's actually moving the conversations is the regulatory pressure around NIST's post-quantum standards, which gives their internal champions a compliance narrative to bring to procurement.
[BB] Synthesis:
• You are in the classic first-mover deadlock: the reference unlocks the pilot, the pilot creates the reference.
• The only thing moving the banks is external regulatory pressure — NIST standards giving internal champions a compliance story — not your product evidence.
• Your site markets the protocol architecture, not the compliance narrative that is actually opening doors inside these institutions.
• The 200+ pipeline claim and the ten pages of cryptographic depth are aimed at a technical buyer; the real decision-maker right now is a procurement or compliance committee that needs a regulatory justification, not a whitepaper.

Diagnostic: Your go-to-market is built for a technical evaluator, but the actual purchase is being made by a compliance function responding to a regulatory deadline — and nothing you publish speaks directly to that person or that moment.
GOAL STEP: confirm shown: "Closing the gap to customer-accessible products via a first bank pilot" → founder confirms
STRATEGY: proposal | bet: Turn the private testnet into a credible, shareable proof of work that a bank champion can put in front of their procurement committee | over: Building out public-facing product pages, developer docs, or broader market awareness | horizon: Six months | assumed: None
answers: 3 | BB questions after the opener: 2

========================= RUN c
CONSTRAINT: No customer has used QuFi and got a result, so every claim about the network — its performance, its pipeline, its products — is unanchored.
[BB (opener)] I have read what you gave me — here is what stands out about QuFi Network before we talk.
You have built a protocol-first story, but buyers buy products — QuVault, QuSettle and QuFi Verify each get one paragraph and no access path.
The quantum threat framing is credible and timely, but 200+ pipeline organisations with no name, logo or pilot makes the urgency feel asserted rather than proven.
Your interoperability angle — EVM, UTXO, SVM, ISO 20022, no protocol changes — is the sharpest differentiator, yet it lives buried in architecture pages, not in the product pitch.
Whether any part of the network is actually running today — the site reads like a live product but shows no evidence of one.
What is live right now — and what is still being built?
[Founder (answer 1)] The network is running on a private testnet today, with QuVault, QuSettle, and QuFi Verify all functional in that environment. We're in pilot discussions with two banks to move from testnet to a live deployment, which is the immediate milestone we're focused on. Public mainnet comes after that first signed pilot.
[BB] Private testnet with all three products functional — that is a real milestone, and it changes the read entirely. The tension now is not 'is this real?' but 'why does the site still read like a whitepaper launch rather than a company closing its first enterprise deal?' Two banks in pilot discussions means you are in a sales process right now — and the site is not doing any work in that process.

Of the two banks in pilot discussions — what is the specific problem each one is trying to solve, and which of the three products is actually on the table?
[Founder (answer 2)] Both conversations are centered on transaction verification integrity — one bank is focused on securing interbank settlement flows, the other on custody authentication — so it's effectively the verification layer in both cases, just applied to different internal workflows.
[BB] So the two pilots are actually QuSettle and QuVault by another name — the banks are not buying the protocol, they are buying a specific workflow fix. That is useful: it means you have two distinct proof points forming at once, but it also means you are running two different sales conversations with two different value propositions simultaneously, which is a real resource question for a pre-mainnet team.

Which of the two is closer to a signed agreement — and what is the one thing standing between you and that signature right now?
[Founder (answer 3)] QuSettle is closer — we're at the term-sheet stage with that bank. The one thing standing between us and a signature is their legal team's sign-off on liability language around settlement finality in the event of a network fault, which is a narrow but slow-moving blocker.
[BB] Synthesis:
• QuSettle pilot is at term-sheet stage — the blocker is legal, not product or trust.
• Liability language around 'network fault' is a narrow question, but it signals the bank needs a defined risk boundary before they sign.
• Your site and collateral are still in thesis mode — they cannot help a legal team get comfortable with finality risk.
• You are running two enterprise sales simultaneously, pre-mainnet, with no public proof of a live deployment.

Diagnostic: The real constraint is not the legal team moving slowly — it is that you have no external artefact (a published fault-handling policy, a liability framework doc, a testnet audit report) that gives their lawyers something concrete to approve; the site cannot close this deal because it was never built to.
GOAL STEP: confirm shown: "First signed pilot with a bank is the immediate milestone; public mainnet comes after that." → founder confirms
STRATEGY: proposal | bet: Put everything behind closing the QuSettle pilot, and give the bank's legal and compliance team exactly what they need to get comfortable with the liability question. | over: Building broader awareness or developer traction before you have a signed pilot. | horizon: Immediate, pre-mainnet. | assumed: None
answers: 3 | BB questions after the opener: 2

```
