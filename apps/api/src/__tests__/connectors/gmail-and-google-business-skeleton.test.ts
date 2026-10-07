import { describe, it, expect } from 'vitest';
import { GmailConnector } from '../../connectors/gmail/gmail.connector';
import { GMAIL_SCOPES, buildAuthUrl as buildGmailAuthUrl, type GmailOAuthConfig } from '../../connectors/gmail/gmail-oauth';
import { GoogleBusinessConnector } from '../../connectors/google-business/google-business.connector';
import {
  GOOGLE_BUSINESS_SCOPES, buildAuthUrl as buildGoogleBusinessAuthUrl, type GoogleBusinessOAuthConfig,
} from '../../connectors/google-business/google-business-oauth';
import { PendingAuthStore, createPkce } from '../../auth/oauth';
import type { CredentialStore, StoredCredential } from '../../auth/credential-store';

/**
 * Skeleton proof for the two FUTURE, unwired Google connectors (Gmail + Google Business Profile).
 * These are hidden and pending Google approval, so the assertions document intent rather than a live
 * flow: (1) each read method is a STUB that returns the typed 'not_available' shape and touches no
 * network, and (2) each buildAuthUrl embeds the correct provider scope. Fully offline.
 */

const FID = 'dev-founder';

// A credential store that never yields a credential — the skeletons are not connected to anything.
class EmptyStore implements CredentialStore {
  async save() { /* no-op */ }
  async load(): Promise<StoredCredential | null> { return null; }
  async has() { return false; }
  async delete() { /* no-op */ }
}

const GMAIL_OAUTH: GmailOAuthConfig = { clientId: 'x', clientSecret: 'x', redirectUri: 'http://localhost/cb' };
const GBP_OAUTH: GoogleBusinessOAuthConfig = { clientId: 'x', clientSecret: 'x', redirectUri: 'http://localhost/cb' };

describe('Gmail + Google Business Profile — skeleton (hidden, unwired)', () => {
  it('GmailConnector.readRecentBusinessMail is a not_available stub (no network)', async () => {
    const conn = new GmailConnector(new EmptyStore(), GMAIL_OAUTH, new PendingAuthStore());
    const res = await conn.readRecentBusinessMail(FID);
    expect(res.status).toBe('not_available');
    expect(res.founderId).toBe(FID);
    expect(res.boundedBy).toBe('none');
    expect(res.messagesRead).toBe(0);
    expect(res.fragmentsStored).toBe(0);
    expect(res.note).toMatch(/skeleton|not available/i);
  });

  it('Gmail buildAuthUrl requests the gmail.readonly scope', () => {
    expect(GMAIL_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
    const url = buildGmailAuthUrl(GMAIL_OAUTH, 'state123', createPkce());
    const scope = new URL(url).searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
  });

  it('GoogleBusinessConnector.readLocationsAndReviews is a not_available stub (no network)', async () => {
    const conn = new GoogleBusinessConnector(new EmptyStore(), GBP_OAUTH, new PendingAuthStore());
    const res = await conn.readLocationsAndReviews(FID);
    expect(res.status).toBe('not_available');
    expect(res.founderId).toBe(FID);
    expect(res.locationsRead).toBe(0);
    expect(res.reviewsRead).toBe(0);
    expect(res.fragmentsStored).toBe(0);
    expect(res.note).toMatch(/skeleton|not available/i);
  });

  it('Google Business buildAuthUrl requests the business.manage scope', () => {
    expect(GOOGLE_BUSINESS_SCOPES).toContain('https://www.googleapis.com/auth/business.manage');
    const url = buildGoogleBusinessAuthUrl(GBP_OAUTH, 'state123', createPkce());
    const scope = new URL(url).searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/business.manage');
  });
});
