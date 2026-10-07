# UI in English, content in the founder's language

**Status:** in-build (2026-10-07). Operator rule, decided in session; design choice "per business, detected" made by
the operator.

## The rule
1. The UI is always English once logged in (buttons, labels, chrome, navigation). No in-app language switcher; the
   account locale does not drive the UI. The public marketing page (`/`) is already English.
2. Everything a model writes follows the business's CONTENT language: one per business, decided once, never per
   message. Order: stored `businesses.content_language` → the first understanding's detected `source_language`
   (legacy businesses, e.g. Body Move = Romanian, no migration) → account locale → `en`.
3. Decided at first understanding from the founder's own material (majority of the observations' detected
   languages); if there is no material, a clear founder message decides it once (≥40 chars, clear winner). A short
   "ok"/"thanks" or a borrowed word never decides or flips it. Only an explicit request ("reply in English",
   "răspunde în română", "rispondi in inglese") changes it.

## Audit
`ui-strings-audit.csv`: all 764 UI keys with the EN text now shown and the previous RO/IT text. 0 keys lack EN.
No Romanian/Italian UI text is hardcoded in the web app outside the message table. Server-sent RO strings fixed:
the landing route's blocked/pending messages, `NO_ADOPTED_STRATEGY_MESSAGE`, and the landing model's job
instruction (now neutral English; the generator writes in the content language).

## Needs before deploy
V084 (`workspace.businesses.content_language`), behind `approve migration`.
