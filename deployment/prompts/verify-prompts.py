#!/usr/bin/env python3
"""
verify-prompts.py — Engine Governance P1 verification (read-only).

For every system_template source file in this directory (PR-NNN-*.txt, excluding the
*.user.txt companions), recompute sha256(file bytes) and assert it equals the live
`validation_hash` in app.prompt_registry. This proves the tracked files are a byte-exact
mirror of the runtime-hashed prompt state. Fails loudly (non-zero exit) on ANY mismatch,
missing prompt, or orphan file.

Read-only: a single SELECT against the DB via the repo's existing psql tooling. Mirrors
load-prompts.py's filename->prompt_id convention ("PR-NNN" = first two hyphen segments).
NOTE: user_template (*.user.txt) is captured-only in P1 and is NOT hashed/verified here
(it is not loader-managed until P3).
"""
import hashlib, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

def db_hashes():
    sql = "SELECT prompt_id || '|' || validation_hash FROM app.prompt_registry ORDER BY prompt_id;"
    cmd = ["docker", "compose", "exec", "-T", "postgres", "psql",
           "-U", "bbuser", "-d", "businessbrain", "-tA", "-c", sql]
    res = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if res.returncode != 0:
        print("DB query failed:", res.stderr[-300:]); sys.exit(2)
    out = {}
    for line in res.stdout.splitlines():
        line = line.strip()
        if "|" in line:
            pid, h = line.split("|", 1)
            out[pid] = h
    return out

def main():
    hashes = db_hashes()
    sys_files = sorted(
        f for f in os.listdir(HERE)
        if f.endswith(".txt") and not f.endswith(".user.txt")
    )
    if not sys_files:
        print("No system_template files found."); sys.exit(2)

    ok = True
    seen = set()
    print(f"{'prompt_id':10} {'file_sha256':16} {'db_hash':16} MATCH  file")
    for fn in sys_files:
        pid = "-".join(fn.replace(".txt", "").split("-")[:2])
        seen.add(pid)
        with open(os.path.join(HERE, fn), "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        expected = hashes.get(pid)
        match = expected is not None and digest == expected
        ok = ok and match
        print(f"{pid:10} {digest[:16]} {(expected or '(absent)')[:16]:16} "
              f"{'Y' if match else 'N':5}  {fn}")

    # Coverage: every DB prompt must have a tracked file.
    missing = sorted(set(hashes) - seen)
    if missing:
        ok = False
        print("MISSING tracked files for DB prompts:", ", ".join(missing))

    print("\nRESULT:", "PASS — all system_template files mirror the live hashes." if ok
          else "FAIL — at least one mismatch/missing file (see above).")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
