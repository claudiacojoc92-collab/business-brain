import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus } from '@bb/application';
import type { IQueryBus } from '@bb/application';
import type { Command } from '@bb/application';
import type { Query } from '@bb/application';
import type { JwtService } from '@bb/infrastructure';
import type { PasswordService } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { ValidationError } from '@bb/shared';
import { AuthenticationError } from '@bb/shared';

interface RegisterBody {
  email: string;
  name: string;
  businessName: string;
  timezone: string;
  password: string;
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
  ) {}

  async register(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = request.body as RegisterBody;

    if (!body.email || !body.name || !body.businessName || !body.timezone) {
      throw new ValidationError('MISSING_REQUIRED_FIELDS', 'email, name, businessName, and timezone are required.');
    }

    const result = await this.commandBus.dispatch<
      { founderId: string },
      import('@bb/shared').ApplicationError
    >({
      type:           'RegisterFounder',
      email:          body.email,
      name:           body.name,
      businessName:   body.businessName,
      timezone:       body.timezone,
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) {
      throw result.error;
    }

    await reply.status(201).send({ founder_id: result.value.founderId });
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
