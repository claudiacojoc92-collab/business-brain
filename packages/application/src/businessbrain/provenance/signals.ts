/**
 * Deterministic per-post signals (Phase ②). Pure, rule-based — NOT a classifier and NOT the model.
 * These are the only per-post "classifications" we persist; anything qualitative (theme, whether the
 * offer is legible) is the single LLM call's holistic job, never a per-post decision.
 */
import type { PostSignals } from './model';

// A link is present if the caption carries a URL or the canonical "link in bio" pointer.
const LINK_RE = /(https?:\/\/\S+|www\.\S+|link in bio|linkin\.?bio|\b\S+\.(com|co|io|net|org|shop|store)\b)/i;

// Deterministic call-to-action markers (imperative asks). Kept conservative to avoid false positives.
const CTA_RES: readonly RegExp[] = [
  /link in bio/i, /\bdm (me|us)\b/i, /\bsend (me|us) a (dm|message)\b/i,
  /\bsign up\b/i, /\bsubscribe\b/i, /\bregister\b/i, /\benroll\b/i,
  /\bbook (a|your|now)\b/i, /\bshop now\b/i, /\bbuy (now|it)\b/i, /\border (now|yours)\b/i,
  /\bget (started|yours|your)\b/i, /\bclick (the|here)\b/i, /\bcheck (out|the link)\b/i,
  /\bcomment .*(below|to)\b/i, /\bavailable now\b/i, /\blimited (spots|time)\b/i,
  /\bapply (now|today)\b/i, /\bjoin (now|us|the)\b/i, /\bdownload\b/i, /\bcontact (me|us)\b/i,
];

const HASHTAG_RE = /#[\p{L}0-9_]+/gu;
const MENTION_RE = /@[\p{L}0-9_.]+/gu;

/** Compute deterministic signals for one caption. Empty/undefined caption → all-zero/false signals. */
export function computePostSignals(caption: string | null | undefined): PostSignals {
  const c = (caption ?? '').toString();
  const trimmed = c.trim();
  const words = trimmed ? trimmed.split(/\s+/u) : [];
  return {
    captionLength: c.length,
    wordCount: words.length,
    hashtagCount: (c.match(HASHTAG_RE) ?? []).length,
    mentionCount: (c.match(MENTION_RE) ?? []).length,
    hasLink: LINK_RE.test(c),
    hasCta: CTA_RES.some((re) => re.test(c)),
  };
}
