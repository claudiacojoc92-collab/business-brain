#!/usr/bin/env python3
"""
check-prompts.py — Engine Governance P2: self-contained, DB-FREE prompt hash gate.

Compares every committed `system_template` file against the committed manifest
(prompt-hashes.json) — NO database connection. Designed to run anywhere (CI, any checkout).
Enforces:
  - HASH:      sha256(system_template file bytes) == manifest sha256
  - COVERAGE:  every manifest prompt has its system_template file
  - NO-EXTRA:  no PR-*.txt system file exists that isn't in the manifest
  - BYTE-EXACT: LF-only (no CR) and trailing-newline state matches the manifest
  - COMPANION: each user_template companion file is present (presence only — NOT hashed)

The manifest was captured once from live truth (app.prompt_registry.validation_hash) in P2
and verified to equal sha256 of the committed files; thereafter this gate is the source of
truth and never reads the DB. user_template is captured-only (loader management is P3).

Exit non-zero on ANY failure. Stdlib only.
"""
import hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "prompt-hashes.json")

def main():
    if not os.path.exists(MANIFEST):
        print(f"FAIL: manifest not found: {MANIFEST}"); sys.exit(2)
    with open(MANIFEST, "r", encoding="utf-8") as f:
        entries = json.load(f)["prompts"]

    ok = True
    expected_sys_files = set()
    print(f"{'prompt_id':10} {'hash':5} {'nl':5} {'companion':9}  file")
    for e in entries:
        pid, sysf, userf = e["prompt_id"], e["system_file"], e["user_file"]
        expected_sys_files.add(sysf)
        sp = os.path.join(HERE, sysf)
        if not os.path.exists(sp):
            print(f"{pid:10} MISSING system_template file: {sysf}"); ok = False; continue
        b = open(sp, "rb").read()
        hash_ok = hashlib.sha256(b).hexdigest() == e["sha256"]
        nl_ok   = (b.endswith(b"\n") == e["ends_with_newline"]) and (b"\r" not in b)
        comp_ok = os.path.exists(os.path.join(HERE, userf))
        ok = ok and hash_ok and nl_ok and comp_ok
        print(f"{pid:10} {'Y' if hash_ok else 'N':5} {'Y' if nl_ok else 'N':5} "
              f"{'Y' if comp_ok else 'MISSING':9}  {sysf}")

    # NO-EXTRA: any system_template file on disk not in the manifest is drift.
    on_disk = {fn for fn in os.listdir(HERE) if fn.endswith(".txt") and not fn.endswith(".user.txt")}
    extra = sorted(on_disk - expected_sys_files)
    if extra:
        ok = False
        print("UNEXPECTED system_template files (not in manifest):", ", ".join(extra))

    print("\nRESULT:", "PASS — files match the committed manifest (DB-free)." if ok
          else "FAIL — drift detected (see above).")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
