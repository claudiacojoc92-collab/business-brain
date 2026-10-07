import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Query } from '@bb/application';
import type { JwtService } from '@bb/infrastructure';
import type { PasswordService } from '@bb/infrastructure';
import type { FounderAccountService, SupportedLocale } from '@bb/application';
import { generateId } from '@bb/shared';
import { ValidationError } from '@bb/shared';
import { AuthenticationError } from '@bb/shared';

interface RegisterBody {
  email: string;
  name: string;
  password: string;
  interfaceLocale?: SupportedLocale;
}

interface TokenBody {
  email: string;
  password: string;
}

/**
 * Handles authentication endpoints: register, token, revoke.
 * Source: API Specification V1 Section 02.
 */
export class AuthController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus:   IQueryBus,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly founderAccountService: FounderAccountService,
  ) {}

  /**
   * Real self-registration (Slice 0): creates the founder account AND its password
   * credential, then returns an access token so the SPA is signed in immediately.
   * No business name is collected here — the business is created as a separate step.
   */
  async register(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = request.body as RegisterBody;

    if (!body.email || !body.name || !body.password) {
      throw new ValidationError('MISSING_REQUIRED_FIELDS', 'email, name, and password are required.');
    }
    if (body.password.length < 8) {
      throw new ValidationError('WEAK_PASSWORD', 'Password must be at least 8 characters.');
    }

    const passwordHash = await this.passwordService.hash(body.password);
    const account = await this.founderAccountService.register({
      email:           body.email,
      name:            body.name,
      passwordHash,
      interfaceLocale: body.interfaceLocale,
    });

    const { accessToken, expiresIn } = this.jwtService.sign({
      sub:    account.founderId,
      role:   'founder',
      scopes: ['read', 'write'],
    });

    await reply.status(201).send({
      founder_id:   account.founderId,
      access_token: accessToken,
      token_type:   'Bearer',
      expires_in:   expiresIn,
    });
  }

  async token(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = request.body as TokenBody;

    if (!body.email || !body.password) {
      throw new ValidationError('MISSING_CREDENTIALS', 'email and password are required.');
    }

    const authResult = await this.queryBus.dispatch({
      type:          'AuthenticateFounder',
      email:         body.email,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query);

    if (!authResult) {
      throw new AuthenticationError('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const { founderId, passwordHash } = authResult as {
      founderId: string;
      passwordHash: string;
    };

    const valid = await this.passwordService.verify(body.password, passwordHash);
    if (!valid) {
      throw new AuthenticationError('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const { accessToken, expiresIn } = this.jwtService.sign({
      sub:    founderId,
      role:   'founder',
      scopes: ['read', 'write'],
    });

    await reply.status(200).send({
      access_token: accessToken,
      token_type:   'Bearer',
      expires_in:   expiresIn,
    });
  }

  async revoke(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Token revocation via blocklist — implemented post-M15
    await reply.status(204).send();
  }
}
