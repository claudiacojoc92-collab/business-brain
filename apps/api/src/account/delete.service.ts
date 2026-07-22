import { sql } from 'kysely';
import { FieldEncryptor } from '@bb/infrastructure';
import { PgCredentialStore } from '../auth/pg-credential-store';
import { GoogleConnector } from '../connectors/google/google.connector';
import { PendingAuthStore } from '../auth/oauth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/**
 * Permanent account deletion (S0-T4, Article XIII — "permanently remove"). ONE atomic transaction, HARD
 * delete, explicit ordered deletes (no cascade from the identity root — the nucleus tables carry a bare
 * founder_id with no FK, by design). Any failure rolls the whole thing back: a partial delete leaving
 * orphaned fragments is worse than none. Idempotent — deleting an already-deleted founder is a safe no-op.
 *
 * Delete order (identity-space only; M2 tables key to the DISJOINT founder.founders space and hold no rows
 * for a magic-link founder; app.domain_events has no founder_id and app.idempotency_keys is never written
 * by S0 code — all excluded, verified S0-T4 C2). magic_link_tokens key by EMAIL, so the email is read first.
 */
export async function deleteFounderAccount(
  founderId: string,
  db: AnyDB,
  opts: { failBeforeRootDelete?: () => Promise<void> } = {}, // test seam only; prod passes nothing
): Promise<{ deleted: boolean }> {
  return db.transaction().execute(async (tx: AnyDB) => {
    const founder = await tx.selectFrom('identity.founders').select(['email']).where('founder_id', '=', founderId).executeTakeFirst();
    if (!founder) return { deleted: false }; // unknown / already-deleted → idempotent no-op success
    const email = founder.email as string;

    // Strategic Learning revisions (V078) and Promotion events (V079) are append-only with BEFORE-DELETE guards.
    // Founder-account deletion is the ONLY sanctioned removal path — opt in so the bulk deletes below are permitted.
    await sql`SET LOCAL bb.allow_learning_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_promotion_delete = 'on'`.execute(tx);
    await tx.deleteFrom('business.learning_promotion_event').where('founder_id', '=', founderId).execute(); // ADR-013 (V079) — promotion ledger
    await sql`SET LOCAL bb.allow_snapshot_delete = 'on'`.execute(tx);
    await tx.deleteFrom('business.context_snapshot').where('founder_id', '=', founderId).execute(); // ADR-014 (V081) — context snapshots
    await sql`SET LOCAL bb.allow_execution_report_delete = 'on'`.execute(tx);
    await tx.deleteFrom('business.execution_report').where('founder_id', '=', founderId).execute(); // ADR-015 (V083) — execution testimony
    await sql`SET LOCAL bb.allow_strategic_review_delete = 'on'`.execute(tx);
    await tx.deleteFrom('business.strategic_outcome_review').where('founder_id', '=', founderId).execute(); // ADR-016 (V086) — outcome reviews

    await tx.deleteFrom('evidence.fragments').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('app.oauth_credentials').where('founder_id', '=', founderId).execute(); // destroys encrypted tokens
    await tx.deleteFrom('memory.thread_events').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('memory.threads').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('memory.recommendations').where('founder_id', '=', founderId).execute();
    await tx.deleteFrom('business_read.snapshots').where('founder_id', '=', founderId).execute(); // S1-T3 immutable Read snapshots
    await tx.deleteFrom('business.understanding').where('founder_id', '=', founderId).execute();   // Wave 2 (V058) — versioned understanding
    await tx.deleteFrom('business.understanding_run').where('founder_id', '=', founderId).execute(); // Wave 2 (V059) — generation runs
    await tx.deleteFrom('business.conclusion_response').where('founder_id', '=', founderId).execute(); // Wave 2 (V060) — founder response history
    await tx.deleteFrom('business.founder_strategic_context_item').where('founder_id', '=', founderId).execute(); // Wave 4 (V067) — strategic context items (all versions)
    await sql`SET LOCAL bb.allow_learning_candidate_delete = 'on'`.execute(tx);
    await tx.deleteFrom('business.learning_candidate_decision').where('founder_id', '=', founderId).execute(); // ADR-017 (V087) — candidate decisions
    await tx.deleteFrom('business.learning_candidate').where('founder_id', '=', founderId).execute();          // ADR-017 (V087) — learning candidates
    await tx.deleteFrom('business.strategic_learning_record').where('founder_id', '=', founderId).execute(); // Wave 4 (V076) — strategic learning records (promoted from reviews; delete first)
    await tx.deleteFrom('business.strategic_plan_review_record').where('founder_id', '=', founderId).execute(); // Wave 4 (V075) — strategic plan reviews
    await tx.deleteFrom('business.strategic_plan_record').where('founder_id', '=', founderId).execute(); // Wave 4 (V074) — strategic plan records (all revisions)
    await tx.deleteFrom('business.strategic_commitment_record').where('founder_id', '=', founderId).execute(); // Wave 4 (V073) — strategic commitment records (all revisions)
    await tx.deleteFrom('business.strategic_decision_record').where('founder_id', '=', founderId).execute(); // Wave 4 (V072) — strategic decision records (all revisions)
    await tx.deleteFrom('business.strategic_response').where('founder_id', '=', founderId).execute(); // Wave 4 (V066) — strategy responses
    await tx.deleteFrom('business.strategic_session').where('founder_id', '=', founderId).execute();  // Wave 4 (V066) — strategy sessions
    await tx.deleteFrom('business.market_review').where('founder_id', '=', founderId).execute();      // Wave 3 (V062) — market reviews
    await tx.deleteFrom('business.market_finding_response').where('founder_id', '=', founderId).execute(); // Wave 3 (V063) — finding response history
    await tx.deleteFrom('business.market_finding').where('founder_id', '=', founderId).execute();     // Wave 3 (V061) — market findings
    await tx.deleteFrom('business.market_entity').where('founder_id', '=', founderId).execute();      // Wave 3 (V061) — market entities
    // Clarity/Sensemaking (V089–V091) — append-only ledgers gated on their delete GUCs (founder-account deletion path).
    await sql`SET LOCAL bb.allow_concern_delete = 'on'`.execute(tx);
    await sql`SET LOCAL bb.allow_understanding_item_delete = 'on'`.execute(tx);
    await tx.deleteFrom('business.clarity_context_use').where('founder_id', '=', founderId).execute();       // V091
    await tx.deleteFrom('business.understanding_revalidation').where('founder_id', '=', founderId).execute(); // V091
    await tx.deleteFrom('business.proposed_understanding_change').where('founder_id', '=', founderId).execute(); // V089
    await tx.deleteFrom('business.understanding_item').where('founder_id', '=', founderId).execute();         // V090
    await tx.deleteFrom('business.clarity_result').where('founder_id', '=', founderId).execute();             // V089
    await tx.deleteFrom('business.concern_message').where('founder_id', '=', founderId).execute();            // V089
    await tx.deleteFrom('business.concern').where('founder_id', '=', founderId).execute();                    // V089

    // Pilot (V092) — personal/business research rows deleted; research_event anonymized (aggregate signal kept, PII dropped).
    for (const t of ['pilot.concern_feedback', 'pilot.concern_reality', 'pilot.facilitator_note', 'pilot.wtp_record', 'pilot.pilot_founder']) {
      await tx.deleteFrom(t).where('founder_id', '=', founderId).execute();
    }
    await tx.updateTable('pilot.invite').set({ founder_id: null, status: 'disabled' }).where('founder_id', '=', founderId).execute();
    await tx.updateTable('pilot.research_event').set({ founder_id: null }).where('founder_id', '=', founderId).execute();

    await tx.deleteFrom('identity.sessions').where('founder_id', '=', founderId).execute();     // revokes all sessions
    await tx.deleteFrom('identity.founder_credentials').where('founder_id', '=', founderId).execute(); // Wave 1 (V056) — password credential
    await tx.deleteFrom('identity.oauth_identities').where('founder_id', '=', founderId).execute();    // Wave 1 (V057) — federated login identities
    await tx.deleteFrom('identity.magic_link_tokens').where('email', '=', email).execute();

    if (opts.failBeforeRootDelete) await opts.failBeforeRootDelete(); // atomicity test: throw here ⇒ full rollback

    await tx.deleteFrom('identity.founders').where('founder_id', '=', founderId).execute();      // root, last
    return { deleted: true };
  });
}

/**
 * Best-effort: revoke the founder's Google token UPSTREAM at Google before the local deletion, so the
 * refresh token is invalidated there too — not merely erased locally. ANY failure is swallowed; it must
 * NEVER block the local deletion (which is authoritative and destroys the encrypted token regardless).
 * No-op when Google OAuth is not configured or the founder has no google credential.
 */
export async function bestEffortGoogleRevoke(founderId: string, db: AnyDB): Promise<void> {
  try {
    const clientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
    const encKeyHex = process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] ?? '';
    if (!clientId || !clientSecret || !encKeyHex) return; // not configured → cannot revoke upstream; local delete still erases it
    const has = await db.selectFrom('app.oauth_credentials').select(['founder_id']).where('founder_id', '=', founderId).where('provider', '=', 'google').executeTakeFirst();
    if (!has) return;
    const store = new PgCredentialStore(db, FieldEncryptor.fromHexKey(encKeyHex));
    const oauth = { clientId, clientSecret, redirectUri: process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/dev/google/callback' };
    // No evidence repo wired → disconnect() only revokes at Google + deletes the local credential (best effort).
    await new GoogleConnector(store, oauth, new PendingAuthStore()).disconnect(founderId);
  } catch { /* swallow — local deletion is authoritative */ }
}
