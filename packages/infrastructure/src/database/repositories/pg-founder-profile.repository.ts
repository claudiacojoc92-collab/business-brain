import type { KyselyDB } from '../client';
import type { IFounderProfileRepository } from '@bb/domain';
import {
  FounderProfile,
  FounderVoice,
  ConvictionAngle,
  Audience,
  AudienceLanguageFingerprint,
  Offer,
} from '@bb/domain';
import { NotFoundError } from '@bb/shared';

/**
 * PostgreSQL implementation of IFounderProfileRepository.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 05.
 */
export class PgFounderProfileRepository implements IFounderProfileRepository {
  constructor(private readonly db: KyselyDB) {}

  async findById(id: string): Promise<FounderProfile | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('founder.founders')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return this.hydrateFounder(row, this.db);
  }

  async findByIdForUpdate(id: string, tx: unknown): Promise<FounderProfile> {
    // F001: SELECT FOR UPDATE — acquires row lock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any)
      .selectFrom('founder.founders')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundError('FOUNDER_NOT_FOUND', `Founder ${id} not found.`);
    }
    return this.hydrateFounder(row, tx);
  }

  async findByEmail(email: string): Promise<FounderProfile | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('founder.founders')
      .selectAll()
      .where('email', '=', email)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    return this.hydrateFounder(row, this.db);
  }

  async save(founder: FounderProfile, tx: unknown): Promise<void> {
    const row = this.toPersistence(founder);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)
      .insertInto('founder.founders')
      .values(row)
      .onConflict((oc: any) => oc.column('id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }

  async findActiveFounders(): Promise<{ id: string; timezone: string }[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (this.db as any)
      .selectFrom('founder.founders')
      .select(['id', 'timezone'])
      .where('status', '=', 'ACTIVE')
      .where('deleted_at', 'is', null)
      .execute();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any) => ({ id: r.id, timezone: r.timezone }));
  }

  /**
   * Loads the founder row's current voice, conviction, audience, and offer
   * (is_current = true) and reconstitutes the full FounderProfile aggregate.
   * Required so the LLM pipeline receives complete founder context.
   */
  private async hydrateFounder(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row: any,
    db: unknown,
  ): Promise<FounderProfile> {
    const [voiceRow, convictionRow, audienceRow, offerRow] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .selectFrom('founder.voice_versions')
        .selectAll()
        .where('founder_id', '=', row.id)
        .where('is_current', '=', true)
        .executeTakeFirst(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .selectFrom('founder.conviction_angles')
        .selectAll()
        .where('founder_id', '=', row.id)
        .where('is_current', '=', true)
        .executeTakeFirst(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .selectFrom('founder.audiences')
        .selectAll()
        .where('founder_id', '=', row.id)
        .where('is_current', '=', true)
        .executeTakeFirst(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .selectFrom('founder.offer_versions')
        .selectAll()
        .where('founder_id', '=', row.id)
        .where('is_current', '=', true)
        .executeTakeFirst(),
    ]);

    // For audience: also load the language fingerprint
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fingerprintRow: any = null;
    if (audienceRow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fingerprintRow = await (db as any)
        .selectFrom('founder.audience_language_fingerprints')
        .selectAll()
        .where('audience_id', '=', audienceRow.id)
        .orderBy('version_number', 'desc')
        .executeTakeFirst();
    }

    return FounderProfile.reconstitute({
      id:                       row.id,
      email:                    row.email,
      name:                     row.name,
      businessName:             row.business_name,
      timezone:                 row.timezone,
      status:                   row.status,
      currentBeliefChain:       null,
      currentVoice: voiceRow ? new FounderVoice({
        versionNumber:      voiceRow.version_number,
        derivedFrom:        voiceRow.derived_from,
        sentenceRhythm:     voiceRow.sentence_rhythm,
        openingPattern:     voiceRow.opening_pattern,
        closingPattern:     voiceRow.closing_pattern,
        convictionPosture:  voiceRow.conviction_posture,
        vulnerabilityLevel: voiceRow.vulnerability_level,
        specificityLevel:   voiceRow.specificity_level,
        ctaStyle:           voiceRow.cta_style,
      }) : null,
      currentConviction: convictionRow ? new ConvictionAngle({
        versionNumber: convictionRow.version_number,
        statement:     convictionRow.statement,
        domain:        convictionRow.domain,
        confidence:    Number(convictionRow.confidence),
        derivedFrom:   convictionRow.derived_from,
      }) : null,
      currentAudience: audienceRow ? new Audience({
        id:                  audienceRow.id,
        description:         audienceRow.description,
        preEngagementState:  audienceRow.pre_engagement_state,
        sophisticationLevel: audienceRow.sophistication_level,
        primaryPlatform:     audienceRow.primary_platform,
        languageFingerprint: fingerprintRow
          ? new AudienceLanguageFingerprint({
              versionNumber:      fingerprintRow.version_number,
              primaryPhrases:     (fingerprintRow.primary_phrases ?? []) as string[],
              avoidPhrases:       (fingerprintRow.avoid_phrases ?? []) as string[],
              emotionalRegister:  fingerprintRow.emotional_register,
              failedAlternatives: (fingerprintRow.failed_alternatives ?? []) as string[],
            })
          : new AudienceLanguageFingerprint({
              versionNumber: 1,
              primaryPhrases: [], avoidPhrases: [],
              emotionalRegister: 'ASPIRATIONAL', failedAlternatives: [],
            }),
      }) : null,
      currentOffer: offerRow ? new Offer({
        id:               offerRow.id,
        versionNumber:    offerRow.version_number,
        name:             offerRow.name,
        primaryPromise:   offerRow.primary_promise,
        priceTier:        offerRow.price_tier,
        salesMechanism:   offerRow.sales_mechanism,
        maturity:         offerRow.maturity,
        availability:     offerRow.availability,
        capacityAvailable:offerRow.capacity_available,
      }) : null,
      notificationChannel:      row.notification_channel ?? 'EMAIL',
      autoApproveOnWindowClose: row.auto_approve_on_window_close ?? true,
      approvalWindowHours:      row.approval_window_hours ?? 72,
      registeredAt:             new Date(row.registered_at),
      activatedAt:              row.activated_at ? new Date(row.activated_at) : null,
      pausedAt:                 row.paused_at ? new Date(row.paused_at) : null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPersistence(founder: FounderProfile): Record<string, any> {
    return {
      id:                          founder.id,
      email:                       founder.email,
      name:                        founder.name,
      business_name:               founder.businessName,
      timezone:                    founder.timezone,
      status:                      founder.status,
      notification_channel:        founder.notificationChannel,
      auto_approve_on_window_close:founder.autoApproveOnWindowClose,
      approval_window_hours:       founder.approvalWindowHours,
      registered_at:               founder.registeredAt.toISOString(),
      activated_at:                founder.activatedAt?.toISOString() ?? null,
      paused_at:                   founder.pausedAt?.toISOString() ?? null,
      deleted_at:                  null,
    };
  }
}
