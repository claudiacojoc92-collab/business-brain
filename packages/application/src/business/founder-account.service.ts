import { generateId, ValidationError, ConflictError } from '@bb/shared';
import type { IFounderAccountRepository, FounderAccountRecord } from './founder-account.repository';
import { coerceLocale, isSupportedLocale, type SupportedLocale } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterAccountInput {
  readonly email: string;
  readonly name: string;
  /** Already hashed by the API layer (PasswordService) — the application layer never sees plaintext. */
  readonly passwordHash: string;
  readonly interfaceLocale?: SupportedLocale;
}

export interface GoogleAccountInput {
  readonly email: string;
  readonly name: string;
  readonly interfaceLocale?: SupportedLocale;
}

/**
 * Founder account use cases (Slice 0): email/password registration, Google account
 * find-or-create, and interface-locale updates.
 */
export class FounderAccountService {
  constructor(private readonly repo: IFounderAccountRepository) {}

  async register(input: RegisterAccountInput): Promise<FounderAccountRecord> {
    const email = (input.email ?? '').trim().toLowerCase();
    const name = (input.name ?? '').trim();
    if (!EMAIL_RE.test(email)) {
      throw new ValidationError('INVALID_EMAIL', 'A valid email is required.');
    }
    if (name.length === 0) {
      throw new ValidationError('NAME_REQUIRED', 'Your name is required.');
    }
    const existing = await this.repo.findByEmail(email);
    if (existing) {
      throw new ConflictError('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
    }
    return this.repo.createAccount({
      founderId: generateId(),
      email,
      name,
      interfaceLocale: coerceLocale(input.interfaceLocale),
      passwordHash: input.passwordHash,
    });
  }

  /** Find an existing account by verified Google email, or create a password-less one. */
  async findOrCreateByGoogle(input: GoogleAccountInput): Promise<FounderAccountRecord> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new ValidationError('INVALID_EMAIL', 'Google did not return a usable email address.');
    }
    const existing = await this.repo.findByEmail(email);
    if (existing) return existing;
    const fallbackName = email.split('@')[0] ?? 'Founder';
    return this.repo.createAccount({
      founderId: generateId(),
      email,
      name: (input.name ?? '').trim() || fallbackName,
      interfaceLocale: coerceLocale(input.interfaceLocale),
      passwordHash: null,
    });
  }

  async setInterfaceLocale(founderId: string, locale: unknown): Promise<SupportedLocale> {
    if (!isSupportedLocale(locale)) {
      throw new ValidationError('UNSUPPORTED_LOCALE', 'Locale must be one of: ro, en, it.');
    }
    await this.repo.updateInterfaceLocale(founderId, locale);
    return locale;
  }

  getById(founderId: string): Promise<FounderAccountRecord | null> {
    return this.repo.getById(founderId);
  }
}
