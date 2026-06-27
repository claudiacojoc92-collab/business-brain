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
