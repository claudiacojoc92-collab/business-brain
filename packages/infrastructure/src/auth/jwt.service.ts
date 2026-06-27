import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;       // founderId (ULID)
  role: 'founder' | 'admin';
  scopes: string[];
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  expiresIn: number;
}

/**
 * JWT service using RS256 asymmetric signing.
 * Private key never leaves the auth service.
 * Access token max age: 900 seconds (15 minutes).
 * Source: Implementation Spec V1 Section 14.
 */
export class JwtService {
  private readonly expiresIn = 900; // 15 minutes

  constructor(
    private readonly privateKey: string,
    private readonly publicKey: string,
  ) {}

  sign(payload: Omit<JwtPayload, 'iat' | 'exp'>): TokenPair {
    const accessToken = jwt.sign(payload, this.privateKey, {
      algorithm: 'RS256',
      expiresIn: this.expiresIn,
      issuer:    'https://auth.businessbrain.ai',
      audience:  'https://api.businessbrain.ai',
    });
    return { accessToken, expiresIn: this.expiresIn };
  }

  verify(token: string): JwtPayload {
    const decoded = jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer:     'https://auth.businessbrain.ai',
      audience:   'https://api.businessbrain.ai',
    });
    return decoded as JwtPayload;
  }
}
