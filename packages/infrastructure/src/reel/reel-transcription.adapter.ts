/**
 * Slice 7 — transcription behind the domain ITranscriptionPort. DeepgramTranscription is the approved MVP
 * provider (Nova); the Reel domain never sees the provider. FakeTranscription is a DETERMINISTIC test/dev double
 * (used when no DEEPGRAM_API_KEY is present) — it does NOT invent business truth; it plays back a scripted
 * transcript so the speech→transcript→safety-disposition path is exercised end-to-end.
 */
import { readFileSync } from 'node:fs';
import type { ITranscriptionPort, TranscriptionInput, ClipTranscript, TranscriptSegment } from '@bb/application';

// broad capability set (BCP-47); provider limits are surfaced honestly, never as a hardcoded product whitelist
const DEEPGRAM_LANGS = ['en', 'ro', 'it', 'es', 'fr', 'de', 'pl', 'cs', 'tr', 'ru', 'uk', 'ar', 'hi', 'ja', 'ko', 'zh', 'pt', 'nl', 'sv'];

export class DeepgramTranscription implements ITranscriptionPort {
  private client: unknown;
  constructor(private readonly apiKey: string, private readonly model = 'nova-2') {}
  capabilities(): { languages: string[] | 'auto'; wordTimestamps: boolean; confidence: boolean } { return { languages: 'auto', wordTimestamps: true, confidence: true }; }
  supports(languageTag: string): 'yes' | 'no' | 'unknown' {
    const base = languageTag.split('-')[0]!.toLowerCase();
    return DEEPGRAM_LANGS.includes(base) ? 'yes' : 'unknown';
  }
  descriptor(): { providerId: string; modelId: string } { return { providerId: 'deepgram', modelId: this.model }; }
  private async sdk(): Promise<{ listen: { prerecorded: { transcribeFile: (b: Buffer, o: unknown) => Promise<unknown> } } }> {
    if (!this.client) { const dg = await import('@deepgram/sdk'); this.client = dg.createClient(this.apiKey); }
    return this.client as never;
  }
  async transcribe(input: TranscriptionInput): Promise<ClipTranscript> {
    const dg = await this.sdk();
    const bytes = readFileSync(input.audioPath);
    const res = await dg.listen.prerecorded.transcribeFile(bytes, { model: this.model, detect_language: true, punctuate: true, smart_format: true, utterances: true, ...(input.hintLanguage ? { language: input.hintLanguage.split('-')[0] } : {}) }) as { result?: { results?: { channels?: Array<{ detected_language?: string; alternatives?: Array<{ words?: Array<{ start: number; end: number; word: string; confidence?: number }> }> }>; utterances?: Array<{ start: number; end: number; transcript: string; confidence?: number; language?: string }> } } };
    const r = res.result?.results;
    const detected = r?.channels?.[0]?.detected_language ?? input.hintLanguage ?? 'en';
    const segments: TranscriptSegment[] = (r?.utterances ?? []).map((u) => ({ startMs: Math.round(u.start * 1000), endMs: Math.round(u.end * 1000), text: u.transcript, spokenLanguage: u.language ?? detected, confidence: u.confidence, uncertain: (u.confidence ?? 1) < 0.6 }));
    const status = segments.length ? 'transcribed' as const : 'no_intelligible_speech' as const;
    return { transcriptId: 't_' + Math.abs(hashStr(input.sourceRefId + input.audioPath)).toString(36), sourceRefId: input.sourceRefId, detectedLanguage: detected, segments, status, providerId: 'deepgram', modelId: this.model };
  }
}

export interface FakeScript { detectedLanguage: string; segments: Array<{ startMs: number; endMs: number; text: string; confidence?: number; spokenLanguage?: string }> }
export class FakeTranscription implements ITranscriptionPort {
  constructor(private readonly scripts: Record<string, FakeScript>, private readonly langs = DEEPGRAM_LANGS) {}
  capabilities(): { languages: string[] | 'auto'; wordTimestamps: boolean; confidence: boolean } { return { languages: this.langs, wordTimestamps: true, confidence: true }; }
  supports(languageTag: string): 'yes' | 'no' | 'unknown' { return this.langs.includes(languageTag.split('-')[0]!.toLowerCase()) ? 'yes' : 'no'; }
  descriptor(): { providerId: string; modelId: string } { return { providerId: 'fake', modelId: 'deterministic-1' }; }
  async transcribe(input: TranscriptionInput): Promise<ClipTranscript> {
    const s = this.scripts[input.sourceRefId];
    if (!s) return { transcriptId: 't_none_' + input.sourceRefId, sourceRefId: input.sourceRefId, detectedLanguage: 'en', segments: [], status: 'no_intelligible_speech', providerId: 'fake', modelId: 'deterministic-1' };
    const segments: TranscriptSegment[] = s.segments.map((x) => ({ startMs: x.startMs, endMs: x.endMs, text: x.text, spokenLanguage: x.spokenLanguage ?? s.detectedLanguage, confidence: x.confidence ?? 0.95, uncertain: (x.confidence ?? 0.95) < 0.6 }));
    return { transcriptId: 't_' + input.sourceRefId, sourceRefId: input.sourceRefId, detectedLanguage: s.detectedLanguage, segments, status: 'transcribed', providerId: 'fake', modelId: 'deterministic-1' };
  }
}

function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
