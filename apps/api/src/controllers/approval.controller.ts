import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ICommandBus, IQueryBus } from '@bb/application';
import type { Command, Query } from '@bb/application';
import { generateId } from '@bb/shared';
import type { ContentPiece } from '@bb/domain';

interface FounderUser { sub: string }
interface ApproveBody { approval_type?: 'ZERO_EDIT' | 'AUTO_APPROVED' }
interface EditApproveBody {
  edits: Array<{
    edit_id: string;
    edit_type: string;
    original_fragment: string;
    replacement_fragment: string;
  }>;
}
interface RejectBody {
  reason_code: string;
  hard_boundary_flag?: boolean;
}

/**
 * Handles content approval endpoints (approve, edit-approve, reject).
 * The target content_piece is loaded by id (founder-scoped) via the query bus (C4),
 * then handed to the unchanged Approve/Edit/Reject commands. The piece's own cycle_id
 * is authoritative for the command.
 * Source: API Specification V1 Sections 12-14.
 */
export class ApprovalController {
  constructor(
    private readonly commandBus: ICommandBus,
    private readonly queryBus: IQueryBus,
  ) {}

  /** Load the real persisted piece by id, founder-scoped (throws CONTENT_PIECE_NOT_FOUND). */
  private loadPiece(founderId: string, pieceId: string): Promise<ContentPiece> {
    return this.queryBus.dispatch({
      type:          'GetContentPieceForApproval',
      founderId,
      contentPieceId: pieceId,
      correlationId: generateId(),
      traceId:       generateId(),
    } as Query) as Promise<ContentPiece>;
  }

  async approve(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user   = (request as any).user as FounderUser;
    const params = request.params as { id: string };
    const body   = request.body as ApproveBody;
    const piece  = await this.loadPiece(user.sub, params.id);

    const result = await this.commandBus.dispatch({
      type:           'ApproveContent',
      cycleId:        piece.cycleId,
      founderId:      user.sub,
      contentPiece:   piece,
      approvalType:   body.approval_type ?? 'ZERO_EDIT',
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(200).send({ content_piece_id: params.id, status: 'APPROVED' });
  }

  async editAndApprove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user   = (request as any).user as FounderUser;
    const params = request.params as { id: string };
    const body   = request.body as EditApproveBody;
    const piece  = await this.loadPiece(user.sub, params.id);

    const result = await this.commandBus.dispatch({
      type:          'EditAndApproveContent',
      cycleId:       piece.cycleId,
      founderId:     user.sub,
      contentPiece:  piece,
      edits:         body.edits.map((e) => ({
        editId:             e.edit_id,
        editType:           e.edit_type as never,
        originalFragment:   e.original_fragment,
        replacementFragment:e.replacement_fragment,
      })),
      correlationId:  generateId(),
      traceId:        generateId(),
      idempotencyKey: (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(200).send({ content_piece_id: params.id, status: 'APPROVED_WITH_EDITS' });
  }

  async reject(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user   = (request as any).user as FounderUser;
    const params = request.params as { id: string };
    const body   = request.body as RejectBody;
    const piece  = await this.loadPiece(user.sub, params.id);

    const result = await this.commandBus.dispatch({
      type:             'RejectContent',
      cycleId:          piece.cycleId,
      founderId:        user.sub,
      contentPiece:     piece,
      reasonCode:       body.reason_code as never,
      hardBoundaryFlag: body.hard_boundary_flag ?? false,
      correlationId:    generateId(),
      traceId:          generateId(),
      idempotencyKey:   (request.headers['idempotency-key'] as string | undefined) ?? generateId(),
    } as Command);

    if (result.isErr) throw result.error;
    await reply.status(200).send({ content_piece_id: params.id, status: 'REJECTED' });
  }
}
