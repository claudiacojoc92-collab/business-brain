import type { KyselyDB } from '../client';
import type {
  IReelRepository, VideoSetUnderstanding, ClipTranscript, ReelOpportunity, ReelAuthorizationSnapshot,
  ReelAsset, ReelAssetVersion, ReelRenderVersion, ReelSafetyTrace, ReelSourceRef, ReelJob,
} from '@bb/application';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const parse = <T>(v: any, fb: T): T => { if (v == null) return fb; return typeof v === 'string' ? JSON.parse(v) : v; };

/** Slice 7 — reel persistence. Immutable content + append-only lineage/safety; all rows business-scoped. */
export class PgReelRepository implements IReelRepository {
  constructor(private readonly db_: KyselyDB) {}
  private db(): any { return this.db_ as any; }

  async saveVideoSetUnderstanding(x: VideoSetUnderstanding): Promise<void> {
    await this.db().insertInto('workspace.reel_video_understanding').values({ video_set_understanding_id: x.videoSetUnderstandingId, business_id: x.businessId, payload: JSON.stringify(x), content_hash: x.contentHash, produced_at: x.producedAt }).execute();
  }
  async getVideoSetUnderstanding(businessId: string, id: string): Promise<VideoSetUnderstanding | null> {
    const r = await this.db().selectFrom('workspace.reel_video_understanding').selectAll().where('business_id', '=', businessId).where('video_set_understanding_id', '=', id).executeTakeFirst();
    return r ? parse<VideoSetUnderstanding>(r.payload, {} as VideoSetUnderstanding) : null;
  }
  async saveTranscript(x: ClipTranscript): Promise<void> {
    await this.db().insertInto('workspace.reel_transcript').values({ transcript_id: x.transcriptId, source_ref_id: x.sourceRefId, payload: JSON.stringify(x), produced_at: new Date().toISOString() }).onConflict((c: any) => c.column('transcript_id').doNothing()).execute();
  }
  async getTranscript(id: string): Promise<ClipTranscript | null> {
    const r = await this.db().selectFrom('workspace.reel_transcript').selectAll().where('transcript_id', '=', id).executeTakeFirst();
    return r ? parse<ClipTranscript>(r.payload, {} as ClipTranscript) : null;
  }
  async saveOpportunity(x: ReelOpportunity): Promise<void> {
    await this.db().insertInto('workspace.reel_opportunity').values({ opportunity_id: x.opportunityId, business_id: x.businessId, payload: JSON.stringify(x), produced_at: x.producedAt }).execute();
  }
  async getOpportunity(businessId: string, id: string): Promise<ReelOpportunity | null> {
    const r = await this.db().selectFrom('workspace.reel_opportunity').selectAll().where('business_id', '=', businessId).where('opportunity_id', '=', id).executeTakeFirst();
    return r ? parse<ReelOpportunity>(r.payload, {} as ReelOpportunity) : null;
  }
  async saveAuthorizationSnapshot(x: ReelAuthorizationSnapshot): Promise<void> {
    await this.db().insertInto('workspace.reel_authorization_snapshot').values({ snapshot_id: x.snapshotId, business_id: x.businessId, payload: JSON.stringify(x), produced_at: x.producedAt }).execute();
  }
  async getAuthorizationSnapshot(businessId: string, id: string): Promise<ReelAuthorizationSnapshot | null> {
    const r = await this.db().selectFrom('workspace.reel_authorization_snapshot').selectAll().where('business_id', '=', businessId).where('snapshot_id', '=', id).executeTakeFirst();
    return r ? parse<ReelAuthorizationSnapshot>(r.payload, {} as ReelAuthorizationSnapshot) : null;
  }
  async saveAsset(x: ReelAsset): Promise<void> {
    await this.db().insertInto('workspace.reel_asset').values({ asset_id: x.assetId, business_id: x.businessId, create_handoff_id: x.createHandoffId, strategy_version_id: x.strategyVersionId, current_version_id: x.currentVersionId, created_at: x.createdAt }).execute();
  }
  async getAsset(businessId: string, id: string): Promise<ReelAsset | null> {
    const r = await this.db().selectFrom('workspace.reel_asset').selectAll().where('business_id', '=', businessId).where('asset_id', '=', id).executeTakeFirst();
    return r ? { assetId: r.asset_id, businessId: r.business_id, createHandoffId: r.create_handoff_id, strategyVersionId: r.strategy_version_id, currentVersionId: r.current_version_id, createdAt: iso(r.created_at) } : null;
  }
  async setCurrentVersion(assetId: string, versionId: string): Promise<void> {
    await this.db().updateTable('workspace.reel_asset').set({ current_version_id: versionId }).where('asset_id', '=', assetId).execute();
  }
  async saveVersion(x: ReelAssetVersion): Promise<void> {
    await this.db().insertInto('workspace.reel_asset_version').values({ version_id: x.versionId, asset_id: x.assetId, business_id: x.businessId, version_number: x.versionNumber, edl_hash: x.edlHash, content_hash: x.contentHash, payload: JSON.stringify(x), produced_at: x.producedAt }).execute();
  }
  async getVersion(businessId: string, id: string): Promise<ReelAssetVersion | null> {
    const r = await this.db().selectFrom('workspace.reel_asset_version').selectAll().where('business_id', '=', businessId).where('version_id', '=', id).executeTakeFirst();
    return r ? parse<ReelAssetVersion>(r.payload, {} as ReelAssetVersion) : null;
  }
  async saveRender(x: ReelRenderVersion): Promise<void> {
    await this.db().insertInto('workspace.reel_render').values({ render_id: x.renderId, version_id: x.versionId, renderer_version: x.rendererVersion, ffmpeg_build: x.ffmpegBuild, edl_hash: x.edlHash, mp4_key: x.mp4Key, poster_key: x.posterKey, width_px: x.widthPx, height_px: x.heightPx, duration_ms: x.durationMs, gate_valid: x.gateValid, payload: JSON.stringify(x), produced_at: x.producedAt })
      .onConflict((c: any) => c.column('version_id').doUpdateSet({ render_id: x.renderId, mp4_key: x.mp4Key, poster_key: x.posterKey, gate_valid: x.gateValid, payload: JSON.stringify(x) })).execute();
  }
  async getRender(versionId: string): Promise<ReelRenderVersion | null> {
    const r = await this.db().selectFrom('workspace.reel_render').selectAll().where('version_id', '=', versionId).executeTakeFirst();
    return r ? parse<ReelRenderVersion>(r.payload, {} as ReelRenderVersion) : null;
  }
  async recordRevision(e: { assetId: string; fromVersionId: string; toVersionId: string; scope: string; at: string }): Promise<void> {
    await this.db().insertInto('workspace.reel_revision_event').values({ id: `${e.assetId}_${e.toVersionId}`, asset_id: e.assetId, from_version_id: e.fromVersionId, to_version_id: e.toVersionId, scope: e.scope, at: e.at }).execute();
  }
  async saveSafetyTrace(x: ReelSafetyTrace): Promise<void> {
    await this.db().insertInto('workspace.reel_safety_trace').values({ trace_id: x.traceId, business_id: x.businessId, asset_id: x.assetId, version_id: x.versionId, disposition: x.disposition, payload: JSON.stringify(x), produced_at: x.producedAt }).execute();
  }
  async saveSource(businessId: string, s: ReelSourceRef & { uploadSetId: string }): Promise<void> {
    await this.db().insertInto('workspace.reel_source').values({ source_ref_id: s.sourceRefId, business_id: businessId, upload_set_id: s.uploadSetId, object_key: s.objectKey, reuse_right: s.reuseRight, filename: s.filename ?? null, bytes: s.bytes ?? null, sha256: s.sha256 ?? null, container: s.container ?? null, audio_rights: s.audioRightsStatus ?? null, created_at: new Date().toISOString() })
      .onConflict((c: any) => c.column('source_ref_id').doNothing()).execute();
  }
  async listSources(businessId: string, uploadSetId: string): Promise<ReelSourceRef[]> {
    const rows = await this.db().selectFrom('workspace.reel_source').selectAll().where('business_id', '=', businessId).where('upload_set_id', '=', uploadSetId).execute();
    return rows.map((r: any): ReelSourceRef => ({ sourceRefId: r.source_ref_id, objectKey: r.object_key, reuseRight: r.reuse_right, filename: r.filename ?? undefined, bytes: r.bytes ?? undefined, sha256: r.sha256 ?? undefined, container: r.container ?? undefined, audioRightsStatus: r.audio_rights ?? undefined }));
  }
  async saveJob(x: ReelJob): Promise<void> {
    await this.db().insertInto('workspace.reel_job').values({ job_id: x.jobId, business_id: x.businessId, upload_set_id: x.uploadSetId, stage: x.stage, payload: JSON.stringify(x), updated_at: x.updatedAt })
      .onConflict((c: any) => c.column('job_id').doUpdateSet({ stage: x.stage, payload: JSON.stringify(x), updated_at: x.updatedAt })).execute();
  }
  async getJob(businessId: string, jobId: string): Promise<ReelJob | null> {
    const r = await this.db().selectFrom('workspace.reel_job').selectAll().where('business_id', '=', businessId).where('job_id', '=', jobId).executeTakeFirst();
    return r ? parse<ReelJob>(r.payload, {} as ReelJob) : null;
  }
}
