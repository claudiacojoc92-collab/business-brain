# Prompt source files — Engine Governance P1 (faithful mirror)

These files are a **byte-exact mirror of the live `app.prompt_registry`** prompt state, brought
under version control so prompt changes become reviewable and reproducible. **P1 is mirroring
only — it introduces ZERO runtime behavior change.** The database is unchanged; Git simply
becomes a faithful, hash-verified copy of what is already live.

## What's here
- `PR-NNN-<slug>.txt` — the prompt's **`system_template`** (the instruction body). This is the
  **hash-protected** half: the runtime enforces `sha256(system_template) === validation_hash`
  (`packages/infrastructure/src/llm/prompt-registry-client.ts`). Each file recomputes to its
  stored `validation_hash` (run `verify-prompts.py`).
- `PR-NNN-<slug>.user.txt` — the prompt's **`user_template`** (the `{{variable}}` scaffold).
  **CAPTURED FOR REPRODUCIBILITY ONLY.** It is **NOT** hash-protected and **NOT** loader-managed:
  `load-prompts.py` writes only `system_template` + `validation_hash`. Wiring `user_template`
  into the loader is deferred to **P3** (its current write-path provenance is undetermined).

## Byte rules (do not break — the hash is byte-fragile)
- **UTF-8, LF line endings.** A CRLF or encoding change breaks the checksum.
- **Trailing newline is per-file and significant.** `PR-001`…`PR-011` end **without** a final
  newline; `PR-012` ends with **exactly one**. Do not add or strip final newlines.
- `.gitattributes` (LF) and `.editorconfig` (`insert_final_newline = false`) guard this; keep
  them. Most editors "insert final newline" by default — that would corrupt these files.

## Do NOT (in P1)
- Do **not edit prompt content** here in P1 — these must equal the live bytes exactly. Content
  changes are a later, separately-authorized cycle (and are High-risk: they change LLM output).
- Do **not** run the loader as part of P1 — the loader/runtime path is untouched.

## Notes
- **`PR-007` is absent** from the registry (gap between PR-006 and PR-008); there is simply no
  file for it. The export iterates DB rows, so the missing id just doesn't appear.
- Remaining governance phases: **P2** CI hash gate (run `verify-prompts.py` in CI), **P3** loader
  manages `user_template`, **P4** release wiring (run the loader on deploy, like Flyway migrate).

## Verify
```
python3 deployment/prompts/verify-prompts.py
```
Exits non-zero on any mismatch/missing file.
