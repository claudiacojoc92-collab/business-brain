import hashlib, os, subprocess

prompts_dir = "prompts"
db_cmd = "docker compose exec -T postgres psql -U bbuser -d businessbrain"

for filename in sorted(os.listdir(prompts_dir)):
    if not filename.endswith(".txt"):
        continue
    # Registry id is the short "PR-NNN" prefix; filenames are "PR-NNN-description.txt"
    prompt_id = "-".join(filename.replace(".txt", "").split("-")[:2])
    filepath  = os.path.join(prompts_dir, filename)
    with open(filepath, "r", encoding="utf-8") as f:
        body = f.read()
    sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()
    # Escape single quotes for SQL
    body_escaped = body.replace("'", "''")
    sql = (
        f"UPDATE app.prompt_registry "
        f"SET system_template = '{body_escaped}', "
        f"    validation_hash = '{sha256}' "
        f"WHERE prompt_id = '{prompt_id}';"
    )
    result = subprocess.run(
        db_cmd + " -c \"" + sql.replace('"', '\\"') + "\"",
        shell=True, capture_output=True, text=True
    )
    rows = result.stdout.strip()
    print(f"{prompt_id}: {rows} (hash: {sha256[:16]}...)")
