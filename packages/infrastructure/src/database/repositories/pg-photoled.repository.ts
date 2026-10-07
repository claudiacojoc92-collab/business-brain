import type { KyselyDB } from '../client';
import type {
  IPhotoLedRepository, PhotoSetUnderstanding, CarouselOpportunity, PhotoLedCarouselContext, MediaObservation,
  SelectedMediaItem, ExcludedMediaItem,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

/** Slice 6.1 — photo-led media/provenance records (never claims). Immutable, hashed; context is 1:1 per handoff. */
export class PgPhotoLedRepository implements IPhotoLedRepository {
  constructor(private readonly db_: KyselyDB) {}

  async savePhotoSetUnderstanding(x: PhotoSetUnderstanding): Promise<void> {
    await (this.db_ as any).insertInto('workspace.photo_set_understanding').values({
      photo_set_understanding_id: x.photoSetUnderstandingId, business_id: x.businessId,
      observations: JSON.stringify(x.observations), set_signal: x.setSignal, model_id: x.modelId,
      content_hash: x.contentHash, produced_at: x.producedAt,
    }).execute();
  }
  async getPhotoSetUnderstanding(businessId: string, id: string): Promise<PhotoSetUnderstanding | null> {
    const r = await (this.db_ as any).selectFrom('workspace.photo_set_understanding').selectAll()
      .where('business_id', '=', businessId).where('photo_set_understanding_id', '=', id).executeTakeFirst();
    if (!r) return null;
    return { photoSetUnderstandingId: r.photo_set_understanding_id, businessId: r.business_id, observations: parse<MediaObservation[]>(r.observations, []), setSignal: r.set_signal, modelId: r.model_id, contentHash: r.content_hash, producedAt: iso(r.produced_at) };
  }

  async saveOpportunity(x: CarouselOpportunity): Promise<void> {
    await (this.db_ as any).insertInto('workspace.carousel_opportunity').values({
      opportunity_id: x.opportunityId, business_id: x.businessId, photo_set_understanding_id: x.photoSetUnderstandingId,
      origin: x.origin, strategy_version_id: x.strategyVersionId, sufficiency: x.sufficiency,
      payload: JSON.stringify(x), produced_at: x.producedAt,
    }).execute();
  }
  async getOpportunity(businessId: string, id: string): Promise<CarouselOpportunity | null> {
    const r = await (this.db_ as any).selectFrom('workspace.carousel_opportunity').selectAll()
      .where('business_id', '=', businessId).where('opportunity_id', '=', id).executeTakeFirst();
    if (!r) return null;
    return parse<CarouselOpportunity>(r.payload, {} as CarouselOpportunity);
  }

  async savePhotoLedContext(x: PhotoLedCarouselContext): Promise<void> {
    // UNIQUE(create_handoff_id) enforces the 1:1 binding at the DB level.
    await (this.db_ as any).insertInto('workspace.photo_led_carousel_context').values({
      photo_led_context_id: x.photoLedContextId, business_id: x.businessId, create_handoff_id: x.createHandoffId,
      opportunity_id: x.opportunityId, photo_set_understanding_id: x.photoSetUnderstandingId, origin: x.origin,
      strategy_trace: JSON.stringify(x.strategyTrace), selected_media: JSON.stringify(x.selectedMedia),
      excluded_media: JSON.stringify(x.excludedMedia), content_hash: x.contentHash, produced_at: x.producedAt,
    }).execute();
  }
  async getPhotoLedContextByHandoff(businessId: string, createHandoffId: string): Promise<PhotoLedCarouselContext | null> {
    const r = await (this.db_ as any).selectFrom('workspace.photo_led_carousel_context').selectAll()
      .where('business_id', '=', businessId).where('create_handoff_id', '=', createHandoffId).executeTakeFirst();
    if (!r) return null;
    return {
      photoLedContextId: r.photo_led_context_id, businessId: r.business_id, createHandoffId: r.create_handoff_id,
      opportunityId: r.opportunity_id, photoSetUnderstandingId: r.photo_set_understanding_id, origin: r.origin,
      strategyTrace: parse(r.strategy_trace, { strategyVersionId: '', planVersionId: null, actionId: null }),
      selectedMedia: parse<SelectedMediaItem[]>(r.selected_media, []), excludedMedia: parse<ExcludedMediaItem[]>(r.excluded_media, []),
      contentHash: r.content_hash, producedAt: iso(r.produced_at),
    };
  }
}
