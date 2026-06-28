import { describe, it, expect } from 'vitest';
import { JwtService } from '../../auth/jwt.service';
import { generateKeyPairSync } from 'crypto';

// Generate a real RSA key pair for testing
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength:   2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('JwtService', () => {
  it('signs and verifies a token successfully', () => {
    const service = new JwtService(privateKey, publicKey);
    const { accessToken } = service.sign({
      sub:    'founder-01',
      role:   'founder',
      scopes: ['read', 'write'],
    });
    expect(typeof accessToken).toBe('string');
    expect(accessToken.split('.')).toHaveLength(3); // JWT structure

    const decoded = service.verify(accessToken);
    expect(decoded.sub).toBe('founder-01');
    expect(decoded.role).toBe('founder');
    expect(decoded.scopes).toEqual(['read', 'write']);
  });

  it('returns expiresIn of 900 seconds', () => {
    const service = new JwtService(privateKey, publicKey);
    const { expiresIn } = service.sign({ sub: 'f-01', role: 'founder', scopes: [] });
    expect(expiresIn).toBe(900);
  });

  it('ingests \\n-escaped single-line PEM (env transport) and signs/verifies (RS256)', () => {
    // Simulate env-var transport: real newlines collapsed to literal "\n".
    const escapedPriv = privateKey.replace(/\n/g, '\\n');
    const escapedPub  = publicKey.replace(/\n/g, '\\n');
    expect(escapedPriv).not.toContain('\n');           // genuinely single-line
    expect(escapedPriv).toContain('\\n');              // literal backslash-n present

    const service = new JwtService(escapedPriv, escapedPub);
    const { accessToken } = service.sign({ sub: 'founder-esc', role: 'founder', scopes: ['read'] });
    const decoded = service.verify(accessToken);
    expect(decoded.sub).toBe('founder-esc');
    expect(decoded.scopes).toEqual(['read']);
  });

  it('is idempotent: real-newline PEM (no \\n) ingests unchanged and signs/verifies', () => {
    expect(privateKey).toContain('\n');                // genuine multi-line PEM
    expect(privateKey).not.toContain('\\n');
    const service = new JwtService(privateKey, publicKey);
    const decoded = service.verify(service.sign({ sub: 'founder-nl', role: 'founder', scopes: [] }).accessToken);
    expect(decoded.sub).toBe('founder-nl');
  });

  it('throws when verifying with wrong public key', () => {
    const { publicKey: wrongPublicKey } = generateKeyPairSync('rsa', {
      modulusLength:      2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const signer   = new JwtService(privateKey, publicKey);
    const verifier = new JwtService(privateKey, wrongPublicKey);
    const { accessToken } = signer.sign({ sub: 'f-01', role: 'founder', scopes: [] });
    expect(() => verifier.verify(accessToken)).toThrow();
  });
});
