/**
 * The Instagram SUMMARY source for synthesis. The pour-in stores the profile and each post as their own evidence
 * fragments; synthesis reads them as ONE observation ("Instagram @handle, N recent posts") so 50 posts cost one
 * source slot and ~2k tokens instead of crowding the website pages (or being cut after them). Per post: date,
 * caption shortened to ~280 chars, likes + comments. Per-post reach is deliberately left out.
 */
import type { PageObservation } from './contracts';

/** One stored Instagram fragment, as the bridge reads it back (payload fields are optional: legacy rows lack them). */
export interface InstagramFragmentView {
  readonly url: string;
  readonly text: string;
  readonly pageType: string;          // 'instagram_profile' | 'instagram_post'
  readonly meta: Record<string, unknown>;
  /** When BB stored this copy (ms epoch). Re-adding Instagram stores new copies; the newest one wins. */
  readonly capturedAt?: number;
}

export const IG_DIGEST_MAX_CHARS = 8000;
export const IG_CAPTION_MAX_CHARS = 280;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

interface Post { url: string; date: string | null; caption: string; likes: number | null; comments: number | null }

function postOf(f: InstagramFragmentView): Post | null {
  // Structured payload (current ingest) first; legacy rows only have "caption\n(12 likes, 3 comments, reach 40)".
  let caption = str(f.meta['caption']);
  let likes = num(f.meta['likes']);
  let comments = num(f.meta['comments']);
  if (caption == null) {
    const m = f.text.match(/^([\s\S]*?)\n\(([^)]*)\)\s*$/);
    caption = (m?.[1] ?? f.text).trim();
    const tail = m?.[2] ?? '';
    const l = tail.match(/(\d+) likes?/);
    const c = tail.match(/(\d+) comments?/);
    likes = likes ?? (l ? Number(l[1]) : null);
    comments = comments ?? (c ? Number(c[1]) : null);
  }
  if (!caption) return null;
  const postedAt = str(f.meta['postedAt']);
  return { url: f.url, date: postedAt ? postedAt.slice(0, 10) : null, caption, likes, comments };
}

/** Build the one Instagram observation, or null when there is nothing to read. */
const storedAt = (f: InstagramFragmentView): number => f.capturedAt ?? 0;
const isDated = (f: InstagramFragmentView): boolean => str(f.meta['postedAt']) != null;
/** Of two stored copies of the same post, keep the dated one (current ingest), then the newest. */
const betterCopy = (a: InstagramFragmentView, b: InstagramFragmentView): InstagramFragmentView =>
  isDated(a) !== isDated(b) ? (isDated(a) ? a : b) : (storedAt(b) > storedAt(a) ? b : a);

export function instagramDigest(fragments: readonly InstagramFragmentView[]): PageObservation | null {
  // Re-adding Instagram stores new copies of the profile and of posts already read: use the newest profile and,
  // per post URL, the newest dated copy (older undated rows would otherwise shadow it).
  const profile = fragments.filter((f) => f.pageType === 'instagram_profile')
    .reduce<InstagramFragmentView | undefined>((best, f) => (!best || storedAt(f) > storedAt(best) ? f : best), undefined);
  const byUrl = new Map<string, InstagramFragmentView>();
  const unkeyed: InstagramFragmentView[] = [];
  for (const f of fragments) {
    if (f.pageType !== 'instagram_post') continue;
    if (!f.url) { unkeyed.push(f); continue; }
    const prev = byUrl.get(f.url);
    byUrl.set(f.url, prev ? betterCopy(prev, f) : f);
  }
  const posts: Post[] = [];
  for (const f of [...byUrl.values(), ...unkeyed]) {
    const p = postOf(f);
    if (p) posts.push(p);
  }
  if (!profile && posts.length === 0) return null;
  // Newest first when dated; undated (legacy) rows keep their stored order after the dated ones.
  posts.sort((a, b) => (a.date && b.date ? b.date.localeCompare(a.date) : a.date ? -1 : b.date ? 1 : 0));

  const username = str(profile?.meta['username']) ?? (profile?.text.match(/@([\w.]+)/)?.[1] ?? null);
  const handle = username ? `@${username}` : 'Instagram';
  const profileUrl = profile?.url || (username ? `https://instagram.com/${username}` : posts[0]?.url ?? 'https://instagram.com');
  const facts = [
    num(profile?.meta['followersCount']) != null ? `${num(profile?.meta['followersCount'])} followers` : null,
    num(profile?.meta['mediaCount']) != null ? `${num(profile?.meta['mediaCount'])} posts on the account` : null,
    str(profile?.meta['accountType']) ? `account type ${str(profile?.meta['accountType'])}` : null,
  ].filter(Boolean).join(' · ');

  const head = [`Instagram ${handle}, ${posts.length} recent post${posts.length === 1 ? '' : 's'}.`];
  if (facts) head.push(facts + '.');
  else if (profile && !str(profile.meta['username'])) head.push(profile.text.trim()); // legacy profile line
  head.push('Posts, newest first (date · caption · likes, comments):');

  let text = head.join('\n');
  let included = 0;
  for (const p of posts) {
    const eng = [p.likes != null ? `${p.likes} likes` : null, p.comments != null ? `${p.comments} comments` : null].filter(Boolean).join(', ');
    const line = `\n- ${p.date ?? 'undated'} · ${shorten(p.caption, IG_CAPTION_MAX_CHARS)}${eng ? ` · ${eng}` : ''}`;
    if (text.length + line.length > IG_DIGEST_MAX_CHARS) break;
    text += line;
    included += 1;
  }
  if (included < posts.length) text += `\n(${posts.length - included} older posts left out to keep this summary short.)`;

  return {
    ref: `Instagram (${handle})`,
    url: profileUrl,
    pageType: 'instagram_digest',
    title: null,
    text,
    lang: null,
    provenance: 'observed',
    sourceKind: 'instagram',
  };
}
