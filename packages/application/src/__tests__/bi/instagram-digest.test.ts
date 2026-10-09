import { describe, it, expect } from 'vitest';
import { instagramDigest, IG_DIGEST_MAX_CHARS, type InstagramFragmentView } from '../../bi/instagram-digest';

const profile: InstagramFragmentView = {
  url: 'https://instagram.com/bodymove', pageType: 'instagram_profile', text: 'Instagram @bodymove. 1200 followers.',
  meta: { username: 'bodymove', followersCount: 1200, mediaCount: 379, accountType: 'MEDIA_CREATOR' },
};
const post = (i: number, caption = `Recovery class ${i}: mobility after knee surgery.`): InstagramFragmentView => ({
  url: `https://instagram.com/p/m${i}`, pageType: 'instagram_post', text: `${caption}\n(${i} likes, 2 comments, reach 99)`,
  meta: { caption, postedAt: `2026-09-${String(30 - (i % 28)).padStart(2, '0')}T10:00:00+0000`, likes: i, comments: 2 },
});

describe('instagramDigest — one Instagram source for synthesis', () => {
  it('folds profile + posts into ONE observed observation: date · caption · likes, comments; no reach', () => {
    const d = instagramDigest([profile, post(1), post(2)])!;
    expect(d.ref).toBe('Instagram (@bodymove)');
    expect(d.sourceKind).toBe('instagram');
    expect(d.provenance).toBe('observed');
    expect(d.text.split('\n')[0]).toBe('Instagram @bodymove, 2 recent posts.');
    expect(d.text).toContain('1200 followers · 379 posts on the account · account type MEDIA_CREATOR.');
    expect(d.text).toContain('- 2026-09-29 · Recovery class 1: mobility after knee surgery. · 1 likes, 2 comments');
    expect(d.text).not.toMatch(/reach/);
  });

  it('shortens long captions to ~280 chars at a word boundary', () => {
    const long = 'word '.repeat(200).trim();
    const d = instagramDigest([profile, post(1, long)])!;
    const line = d.text.split('\n').find((l) => l.startsWith('- '))!;
    const caption = line.split(' · ')[1]!;
    expect(caption.length).toBeLessThanOrEqual(280);
    expect(caption.endsWith('…')).toBe(true);
  });

  it('50 posts with full captions stay within ~8,000 chars, noting any left out', () => {
    const big = 'Some long caption text about the studio, its classes and the people in them. '.repeat(5);
    const d = instagramDigest([profile, ...Array.from({ length: 50 }, (_, i) => post(i, `${i} ${big}`))])!;
    expect(d.text.length).toBeLessThanOrEqual(IG_DIGEST_MAX_CHARS + 80);
    expect(d.text).toMatch(/older posts left out/);
  });

  it('dedupes re-added posts by permalink and orders newest first', () => {
    const d = instagramDigest([profile, post(5), post(1), post(5)])!;
    const lines = d.text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('2026-09-29'); // post 1 is newer than post 5 (2026-09-25)
  });

  it('reads legacy rows (no structured meta) from their text', () => {
    const legacy: InstagramFragmentView = { url: 'https://instagram.com/p/old', pageType: 'instagram_post', text: 'Old caption\n(7 likes, 1 comments, reach 3)', meta: {} };
    const d = instagramDigest([legacy])!;
    expect(d.text).toContain('- undated · Old caption · 7 likes, 1 comments');
  });

  it('nothing to read → null', () => {
    expect(instagramDigest([])).toBeNull();
  });
});
