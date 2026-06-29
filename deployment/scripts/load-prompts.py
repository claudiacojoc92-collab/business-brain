#!/usr/bin/env python3
"""
Load prompt system_template bodies from deployment/prompts/*.txt into app.prompt_registry,
recomputing each validation_hash = sha256(body). The runtime enforces this hash, so the file
is the source of truth for system_template.

Hardened (loader defect fix):
  - Selects ONLY true system_template files: *.txt EXCLUDING the *.user.txt companions.
    (Companions also end in ".txt" and collapse to the same PR-NNN prompt_id, so the unhardened
    glob could overwrite a prompt's system_template with its user_template — corrupting all 11.)
  - CWD-independent: prompts dir and docker-compose context resolve relative to THIS script,
    not the caller's working directory.
  - `--check`: READ-ONLY dry run. Compares what WOULD be written (file body + its sha256) to the
    live DB validation_hash and reports per-prompt no-op status. Writes NOTHING. Use this to prove
    a load is a no-op without executing the mutating path.

Usage:
  python3 deployment/scripts/load-prompts.py            # load (UPDATE) — mutating
  python3 deployment/scripts/load-prompts.py --check     # read-only no-op verification
"""
import hashlib, os, subprocess, sys

# CWD-independent paths: resolve relative to THIS script, never the caller's CWD.
BASE        = os.path.dirname(os.path.abspath(__file__))            # deployment/scripts
REPO_ROOT   = os.path.normpath(os.path.join(BASE, "..", ".."))      # repo root (docker-compose.yml)
PROMPTS_DIR = os.path.normpath(os.path.join(BASE, "..", "prompts")) # deployment/prompts

DB_CMD = "docker compose exec -T postgres psql -U bbuser -d businessbrain"
CHECK  = "--check" in sys.argv[1:]

def is_system_template(fn: str) -> bool:
    # True system_template files only: *.txt but NOT the captured-only *.user.txt companions.
    return fn.endswith(".txt") and not fn.endswith(".user.txt")

def prompt_id_of(fn: str) -> str:
    # Registry id is the "PR-NNN" prefix; filenames are "PR-NNN-description.txt".
    return "-".join(fn.replace(".txt", "").split("-")[:2])

def psql(sql: str):
    # Run from REPO_ROOT so `docker compose` finds the compose file regardless of caller CWD.
    return subprocess.run(
        DB_CMD + ' -tA -c "' + sql.replace('"', '\\"') + '"',
        shell=True, cwd=REPO_ROOT, capture_output=True, text=True,
    )

files = sorted(fn for fn in os.listdir(PROMPTS_DIR) if is_system_template(fn))

if CHECK:
    res = psql("SELECT prompt_id || '|' || validation_hash FROM app.prompt_registry;")
    live = {}
    for line in res.stdout.splitlines():
        if "|" in line:
            pid, h = line.strip().split("|", 1)
            live[pid] = h
    ok = True
    print(f"{'prompt_id':10} {'file_sha':16} {'live_hash':16} NO-OP  file")
    for fn in files:
        pid  = prompt_id_of(fn)
        body = open(os.path.join(PROMPTS_DIR, fn), "rb").read()
        sha  = hashlib.sha256(body).hexdigest()
        expected = live.get(pid)
        # A load would write system_template=body, validation_hash=sha. Equal sha => no change.
        noop = expected is not None and sha == expected
        ok = ok and noop
        print(f"{pid:10} {sha[:16]} {(expected or '(absent)')[:16]:16} {'Y' if noop else 'N':5}  {fn}")
    print("\nDRY-RUN:", "PASS — loading would change nothing (no-op)."
          if ok else "FAIL — a value would change; do NOT load.")
    sys.exit(0 if ok else 1)

# Default (mutating): load each true system_template file and recompute its hash.
for fn in files:
    pid = prompt_id_of(fn)
    with open(os.path.join(PROMPTS_DIR, fn), "r", encoding="utf-8") as f:
        body = f.read()
    sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()
    body_escaped = body.replace("'", "''")
    sql = (
        f"UPDATE app.prompt_registry "
        f"SET system_template = '{body_escaped}', validation_hash = '{sha256}' "
        f"WHERE prompt_id = '{pid}';"
    )
    res = psql(sql)
    print(f"{pid}: {res.stdout.strip()} (hash: {sha256[:16]}...)")
