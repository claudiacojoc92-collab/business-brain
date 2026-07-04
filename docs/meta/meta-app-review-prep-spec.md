# Meta App Review Preparation Spec — Track B (Start the Clock)

**Type:** App Review preparation (BUILD only what's strictly needed to SUBMIT)
**Objective:** Start Meta's external approval clock ASAP. NOT to build the Meta source. Build the minimum needed to submit a compliant App Review, then submit. Everything else waits for approval.

> **Discipline:** the thin Meta connector exists ONLY to record a compliant review demo. If it starts becoming the full Meta source before submission, STOP — that defeats the parallelism. Submit fast; the clock matters more than completeness.

---

## 1. The minimum Meta implementation needed (to submit, nothing more)

Reuse the **proven Google OAuth infrastructure** (ADR-009 — the credential lifecycle is provider-agnostic). Add a Meta provider with the *smallest real read* that satisfies a review demo:

- **Meta app** created (Business/Developer account) with the Facebook Login + Instagram products added.
- **A thin Meta connector** plugged into the existing OAuth credential lifecycle: authorize (Meta OAuth), store credential (encrypted, existing store), one minimal read call that returns real data to show in the demo.
- **Dev-mode read** against the app's own admin/test Business/Instagram account (no approval needed for dev-mode/admin data) — enough to screencast the flow working.
- **NOT built:** the full evidence extraction, temporal/market-reaction analysis, recompute fusion, reflection integration, UI polish. None of that is needed to submit. Build it AFTER approval.

The point: demonstrate a working OAuth + minimal data read for the requested permissions. That's the demo. That's all.

---

## 2. Permissions required (request these in review)

For market-reaction understanding (the eventual Meta source's purpose), the likely permissions:
- `instagram_basic` — basic IG account/media read.
- `instagram_manage_insights` — engagement/reach metrics (the market-reaction signal).
- `pages_read_engagement` — Facebook Page engagement.
- `pages_show_list` — list the founder's Pages.
- `business_management` (if needed for Business account access).

Request the **minimum set** that supports the stated use case. Fewer permissions = faster, cleaner review. Drop any not strictly needed for market-reaction v1.

---

## 3. App Review requirements (what Meta needs to approve)

- **Use-case description** per permission: plain-language explanation of *why* Business Brain needs each permission and *how* the data is used (e.g. "read engagement metrics to help the founder understand how their market responds to their content, compared to their stated positioning").
- **Screencast demo** showing the actual OAuth flow: founder connects → grants permission → the app reads and uses the data. This is why the thin connector must exist — you record *this*.
- **Test credentials / test user** for Meta's reviewers to reproduce the flow.
- **App details:** name, icon, category, description.
- **Data handling / deletion** explanation: how credentials and data are stored (encrypted, ADR-009 containment) and how a founder deletes them.

---

## 4. Demo requirements (the screencast that starts the clock)

The screencast must show, end to end:
1. Founder initiates "Connect Meta" in Business Brain.
2. Meta OAuth consent screen, granting the requested permissions.
3. The app successfully reading the permissioned data (the thin connector's minimal read).
4. A plausible depiction of the stated use (even minimal — showing the data is received and used for the described purpose).

Record against the app's own admin/test Business + Instagram account (dev-mode access, no approval needed to demo).

---

## 5. Privacy policy requirements

- A **public privacy policy URL** (Meta requires it) covering: what Meta data is accessed, why, how it's stored (encrypted), how long, and how the founder deletes it.
- Must be reachable and specific to the Meta data use. (Reuse/extend the existing Business Brain privacy policy if one exists; add the Meta-specific data handling.)
- Data deletion instructions / callback if required.

---

## 6. Review checklist (submit when all checked)

- [ ] Meta Business/Developer account + app created
- [ ] Facebook Login + Instagram products added to the app
- [ ] Thin Meta connector: OAuth flow works against admin/test account (reusing Google credential lifecycle)
- [ ] Minimal real read returning data (for the demo)
- [ ] Requested permissions finalized (minimum set for market-reaction)
- [ ] Use-case descriptions written per permission
- [ ] Screencast recorded (OAuth → grant → read → use)
- [ ] Test user/credentials prepared for reviewers
- [ ] Public privacy policy URL live, covering Meta data handling + deletion
- [ ] App details (name/icon/category/description) complete
- [ ] **SUBMIT** → clock starts

---

## 7. What waits for approval (do NOT build now)

The full Meta source — real market-reaction evidence extraction, fusion into recompute, the "your positioning vs. market response" tension in C, UI — all built AFTER approval, against approved permissions. The connector scaffolding from the demo build carries forward; the rest is post-approval work, parallel to nothing (it's the deferred half).

---

*Objective: submit and start the clock. Reuse Google OAuth infra. Build only what the demo needs. The full Meta source is post-approval work. Do not let the thin connector balloon.*
