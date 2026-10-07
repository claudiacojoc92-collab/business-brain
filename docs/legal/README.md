# docs/legal — archived legal pages (July 2026)

## Origin

`privacy-policy/index.html` and `data-deletion/index.html` were **copied** (not moved) on 2026-09-30
from `~/Desktop/getbusinessbrain-legal/`, preserving the folder structure. `diff -r` between the
Desktop folder and this directory is clean.

They are the first standalone legal pages (both "Last updated: July 5, 2026"), written for the
initial Meta app review. Self-contained HTML with inline CSS, scoped to the Meta (Facebook/Instagram)
connection only, contact `privacy@getbusinessbrain.com`. They do not name the operating company.

## How they compare to the current copies

| Location | Updated | Notes |
|---|---|---|
| `docs/legal/*` (this folder) | 5 Jul 2026 | Oldest. Meta-only scope, no operator entity, no sub-processor list. **Historical reference, not canonical.** |
| `feature/public-site` branch: `privacy-policy.html`, `data-deletion.html`, `terms.html` (getbusinessbrain.com) | 30 Jul 2026 | Superset. Names BLACKLINE SOLUTIONS S.R.L. (Romania) as controller, lists sub-processors (incl. Anthropic), covers account email and site logs, uses the shared site header, `/styles.css`, and canonical/OG meta. Adds Terms. |
| `apps/web/src/legal/LegalPages.tsx`, routed in `apps/web/src/App.tsx` at `/privacy`, `/privacy-policy`, `/terms`, `/data-deletion` (app.getbusinessbrain.com) | 30 Jul 2026 | Same content generation as the public-site pages, rendered as React components with tax ID 45154743 in the footer. |

The two 30 July copies are the live, canonical versions. Edit those, not these files.

## Desktop original

`~/Desktop/getbusinessbrain-legal/` **still exists**. Nothing was deleted. It can be removed
once the user confirms this archive is enough.
