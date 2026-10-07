/**
 * Slice 7 — FfmpegReelRenderer (IReelRenderPort). REAL MP4 assembly. Pinned ffmpeg/ffprobe invoked as a
 * subprocess with an argv ARRAY (never a shell string). normalize-then-compose: each selected range is trimmed +
 * autorotated + center-cropped to 1080×1920 + CFR 30 + yuv420p + canonical audio; the intermediates are
 * concatenated; Skia caption strips are overlaid at their timed offsets; the result is H.264/AAC MP4 +faststart.
 * Security: protocol whitelist, no shell, wall-clock timeout, typed failures. Deterministic filtergraph; the
 * lineage anchor is the EDL hash, not the MP4 bytes.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { edlHash } from '@bb/application';
import type { IReelRenderPort, ReelRenderInput, ReelRenderOutput, ProbeResult, SampledFrame, ReelTextBlock } from '@bb/application';
import { SkiaReelTextRenderer } from './skia-reel-text.renderer';

const FFMPEG = process.env['FFMPEG_PATH'] || 'ffmpeg';
const FFPROBE = process.env['FFPROBE_PATH'] || 'ffprobe';
const CANVAS_W = 1080, CANVAS_H = 1920, FPS = 30;
const RENDER_TIMEOUT_MS = 120_000;

interface RunResult { code: number; stdout: string; stderr: string }
function run(bin: string, args: string[], timeoutMs = RENDER_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); // argv array, NO shell
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`ffmpeg_timeout after ${timeoutMs}ms`)); }, timeoutMs);
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`ffmpeg_spawn_error: ${e.message}`)); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}
async function ff(args: string[], timeoutMs?: number): Promise<void> {
  const r = await run(FFMPEG, args, timeoutMs);
  if (r.code !== 0) throw new Error(`ffmpeg_failed(${r.code}): ${r.stderr.trim().split('\n').slice(-2).join(' ')}`);
}

export class FfmpegReelRenderer implements IReelRenderPort {
  private readonly text = new SkiaReelTextRenderer();
  private cachedBuild: string | null = null;

  rendererVersion(): string { return `ffmpeg-reel+${this.text.rendererVersion()}`; }

  async ffmpegBuild(): Promise<string> {
    if (this.cachedBuild) return this.cachedBuild;
    const r = await run(FFMPEG, ['-hide_banner', '-version']);
    this.cachedBuild = (r.stdout.split('\n')[0] || 'ffmpeg').trim();
    return this.cachedBuild;
  }

  async probe(filePath: string): Promise<ProbeResult> {
    const r = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
    if (r.code !== 0) throw new Error(`ffprobe_failed: ${r.stderr.trim()}`);
    const j = JSON.parse(r.stdout) as { format?: { duration?: string; format_name?: string }; streams?: Array<Record<string, unknown>> };
    const streams = j.streams ?? [];
    const v = streams.find((s) => s['codec_type'] === 'video');
    const a = streams.find((s) => s['codec_type'] === 'audio');
    if (!v) throw new Error('no_video_stream');
    const rate = String(v['avg_frame_rate'] ?? v['r_frame_rate'] ?? '30/1');
    const [rn, rd] = rate.split('/').map(Number); const fps = rn && rd ? rn / rd : 30;
    let rotation = 0;
    const sd = (v['side_data_list'] as Array<Record<string, unknown>> | undefined)?.find((x) => x['rotation'] !== undefined);
    if (sd) rotation = Math.abs(Number(sd['rotation'])) % 360;
    else if (v['tags'] && (v['tags'] as Record<string, unknown>)['rotate']) rotation = Math.abs(Number((v['tags'] as Record<string, unknown>)['rotate'])) % 360;
    return {
      durationMs: Math.round(parseFloat(j.format?.duration ?? '0') * 1000),
      width: Number(v['width'] ?? 0), height: Number(v['height'] ?? 0),
      fps: Math.round(fps * 100) / 100, codec: String(v['codec_name'] ?? 'unknown'),
      container: (j.format?.format_name ?? 'unknown').split(',')[0]!,
      rotationDegrees: rotation, hasAudio: Boolean(a), audioCodec: a ? String(a['codec_name']) : null,
    };
  }

  async sampleFrames(filePath: string, atMsList: number[]): Promise<SampledFrame[]> {
    const dir = mkdtempSync(join(tmpdir(), 'reel-frames-'));
    try {
      const out: SampledFrame[] = [];
      for (const atMs of atMsList) {
        const png = join(dir, `f_${atMs}.png`);
        try {
          await ff(['-y', '-loglevel', 'error', '-protocol_whitelist', 'file', '-ss', (atMs / 1000).toFixed(3), '-i', filePath, '-frames:v', '1', '-vf', 'scale=480:-1', png], 20_000);
          out.push({ atMs, png: readFileSync(png) });
        } catch { /* skip an unreadable timestamp */ }
      }
      return out;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  async render(input: ReelRenderInput): Promise<ReelRenderOutput> {
    const { timeline, textBlocks, sourceFiles } = input;
    const dir = mkdtempSync(join(tmpdir(), 'reel-compose-'));
    try {
      // 1) normalize each segment to a canonical intermediate
      const normPaths: string[] = [];
      const probes = new Map<string, ProbeResult>();
      for (let i = 0; i < timeline.segments.length; i++) {
        const seg = timeline.segments[i]!;
        const src = sourceFiles[seg.sourceRefId];
        if (!src) throw new Error(`missing_source_file:${seg.sourceRefId}`);
        if (!probes.has(seg.sourceRefId)) probes.set(seg.sourceRefId, await this.probe(src));
        const hasAudio = probes.get(seg.sourceRefId)!.hasAudio;
        const outP = join(dir, `n${i}.mp4`);
        await this.normalize(src, outP, seg.inMs, seg.outMs, seg.audioUse, hasAudio);
        normPaths.push(outP);
      }
      // 2) concat (identical params → stream copy)
      const list = join(dir, 'list.txt');
      writeFileSync(list, normPaths.map((p) => `file '${p}'`).join('\n'));
      const concat = join(dir, 'concat.mp4');
      await ff(['-y', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', concat]);
      // 3) build timed Skia overlays (global offset = start of that segment)
      const starts = segStarts(timeline);
      const overlayInputs: string[] = []; const filters: string[] = []; let last = '[0:v]';
      let oi = 1;
      for (let i = 0; i < timeline.segments.length; i++) {
        const seg = timeline.segments[i]!;
        for (const ov of seg.overlays) {
          const block = textBlocks.find((b) => b.blockId === ov.blockId); if (!block) continue;
          const strip = this.text.caption(block.text, CANVAS_W);
          const pngPath = join(dir, `ov${oi}.png`); writeFileSync(pngPath, strip.png);
          overlayInputs.push('-i', pngPath);
          const y = ov.safeRegion === 'top' ? 120 : CANVAS_H - strip.height - 140;
          const s = ((starts[i]! + ov.startMs) / 1000).toFixed(3);
          const e = ((starts[i]! + ov.endMs) / 1000).toFixed(3);
          const outLabel = `[v${oi}]`;
          filters.push(`${last}[${oi}:v]overlay=0:${y}:enable='between(t,${s},${e})'${outLabel}`);
          last = outLabel; oi++;
        }
      }
      // 4) compose final
      const finalP = join(dir, 'reel.mp4');
      const vmap = filters.length ? last : '[0:v]';
      const args = ['-y', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', concat, ...overlayInputs];
      if (filters.length) args.push('-filter_complex', filters.join(';'), '-map', vmap, '-map', '0:a?');
      else args.push('-map', '0:v', '-map', '0:a?');
      args.push('-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-r', String(FPS),
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', finalP);
      await ff(args);
      // 5) poster
      const posterP = join(dir, 'poster.jpg');
      await ff(['-y', '-loglevel', 'error', '-protocol_whitelist', 'file', '-ss', '0.8', '-i', finalP, '-frames:v', '1', '-q:v', '3', posterP], 20_000);

      const outProbe = await this.probe(finalP);
      const build = await this.ffmpegBuild();
      const renderParams: Record<string, string | number> = { vcodec: 'libx264', profile: 'high', pix_fmt: 'yuv420p', crf: 20, preset: 'medium', fps: FPS, acodec: 'aac', abitrate: '128k', ar: 48000, faststart: 1, loudness: 'per_segment_original|muted' };
      return {
        mp4: readFileSync(finalP), poster: readFileSync(posterP),
        widthPx: outProbe.width, heightPx: outProbe.height, durationMs: outProbe.durationMs,
        edlHash: edlHash(timeline, textBlocks as ReelTextBlock[]), ffmpegBuild: build, rendererVersion: this.rendererVersion(), renderParams,
      };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /** Normalize one range → canonical 1080×1920/30/yuv420p/h264 + 48k stereo aac (original source audio, or
   *  injected silence for muted/no-audio). Center-crop to 9:16 (reframe extension is additive later). */
  private async normalize(src: string, out: string, inMs: number, outMs: number, audioUse: string, hasAudio: boolean): Promise<void> {
    const vf = `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H},setsar=1,format=yuv420p`;
    const ss = (inMs / 1000).toFixed(3), to = (outMs / 1000).toFixed(3);
    const useOriginal = audioUse === 'original' && hasAudio;
    const base = ['-y', '-loglevel', 'error', '-protocol_whitelist', 'file', '-ss', ss, '-to', to, '-i', src];
    if (useOriginal) {
      await ff([...base, '-vf', vf, '-fps_mode', 'cfr', '-r', String(FPS), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', out]);
    } else {
      await ff([...base, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-vf', vf, '-fps_mode', 'cfr', '-r', String(FPS), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-map', '0:v:0', '-map', '1:a:0', '-shortest', out]);
    }
  }
}

function segStarts(timeline: ReelRenderInput['timeline']): number[] {
  const starts: number[] = []; let t = 0;
  for (const s of timeline.segments) { starts.push(t); t += (s.outMs - s.inMs); }
  return starts;
}
