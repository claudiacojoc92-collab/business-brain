import { describe, it, expect } from 'vitest';
import { InstagramConnector, returnToFromState } from '../connectors/instagram/instagram.connector';
import { PendingAuthStore } from '../auth/oauth';
import type { CredentialStore } from '../auth/credential-store';

const noopStore: CredentialStore = {
  save: async () => {}, load: async () => null, has: async () => false, delete: async () => {},
};
const mkConnector = () =>
  new InstagramConnector(noopStore, { appId: 'a', appSecret: 's', redirectUri: 'https://app.getbusinessbrain.com/api/sources/instagram/callback' }, new PendingAuthStore());

describe('returnToFromState', () => {
  it('recovers an app path encoded in the state', () => {
    const { state } = mkConnector().authorize('founder-1', '/business-brain');
    expect(returnToFromState(state)).toBe('/business-brain');
  });

  it('recovers /sources for the sources flow', () => {
    const { state } = mkConnector().authorize('founder-1', '/sources');
    expect(returnToFromState(state)).toBe('/sources');
  });

  it('returns null when no returnTo was provided', () => {
    const { state } = mkConnector().authorize('founder-1');
    expect(state).not.toContain('.');
    expect(returnToFromState(state)).toBeNull();
  });

  it('rejects non-app / protocol-relative destinations (open-redirect guard)', () => {
    const enc = (s: string) => 'csrf.' + Buffer.from(s, 'utf8').toString('base64url');
    expect(returnToFromState(enc('//evil.example.com'))).toBeNull();
    expect(returnToFromState(enc('https://evil.example.com'))).toBeNull();
    expect(returnToFromState(enc('not-a-path'))).toBeNull();
    expect(returnToFromState('nostatehere')).toBeNull();
  });

  it('embeds the state in the consent URL and keeps CSRF verifiable via the store', async () => {
    const c = mkConnector();
    const { authUrl, state } = c.authorize('founder-1', '/business-brain');
    // The exact state is round-tripped in the consent URL...
    expect(new URL(authUrl).searchParams.get('state')).toBe(state);
    // ...and the pending entry is keyed by that full state (so an invalid/replayed state is rejected).
    await expect(c.handleCallback('tampered.state', 'code')).rejects.toThrow(/invalid or expired/i);
  });

  it('consent URL sets force_reauth=true (fresh grant) and requests EXACTLY the two Instagram permissions', () => {
    const { authUrl } = mkConnector().authorize('founder-1', '/sources');
    const q = new URL(authUrl).searchParams;
    expect(new URL(authUrl).origin + new URL(authUrl).pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(q.get('force_reauth')).toBe('true');                 // forces the full consent screen (matches Meta's Business Login URL)
    expect(q.get('response_type')).toBe('code');
    // scopes unchanged: the two requested permissions and no others
    const scopes = (q.get('scope') ?? '').split(',').filter(Boolean).sort();
    expect(scopes).toEqual(['instagram_business_basic', 'instagram_business_manage_insights']);
    // no comments / messaging / publishing / any extra permission crept in
    expect(q.get('scope')).not.toMatch(/comment|message|publish|content_publish|manage_comments/i);
  });
});
