/* eslint-disable */
// UNDERSTANDING EVAL — fixture export. Runs INSIDE the api container (railway ssh, read-only): see README.md.
// READ-ONLY: linked evidence fragments for one business, mapped by the deployed repository (exact EvidenceFragment shape).
const infra = require('/app/packages/infrastructure/dist/index.js');
const id = process.argv[2];
(async () => {
  const db = infra.createKyselyClient(process.env.DATABASE_URL);
  try {
    const b = await db.selectFrom('workspace.businesses').select(['id', 'name', 'content_language']).where('id', '=', id).executeTakeFirst();
    const links = await db.selectFrom('workspace.business_evidence_links').select(['evidence_fragment_id']).where('business_id', '=', id).execute();
    const repo = new infra.PgEvidenceRepository(db);
    const fragments = await repo.findByIds(links.map((l) => l.evidence_fragment_id));
    process.stdout.write(JSON.stringify({ businessId: b.id, recordName: b.name, contentLanguage: b.content_language, exportedAt: new Date().toISOString(), fragments }));
  } finally { await db.destroy(); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
