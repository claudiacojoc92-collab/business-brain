import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server';
import { IntakeController }         from '../controllers/intake.controller';
import { LifecycleController }      from '../controllers/lifecycle.controller';
import { OfferController }          from '../controllers/offer.controller';
import { CycleController }          from '../controllers/cycle.controller';
import { ApprovalController }       from '../controllers/approval.controller';
import { OutcomesController }       from '../controllers/outcomes.controller';
import { CampaignController }       from '../controllers/campaign.controller';
import { MemoryController }         from '../controllers/memory.controller';
import { RecalibrationController }  from '../controllers/recalibration.controller';
import { AdminController }          from '../controllers/admin.controller';
import { createAuthMiddleware }     from '../middleware/authenticate';

/**
 * All founder-scoped routes under /v1/founders/me.
 * Auth is enforced via createAuthMiddleware on all /v1/* routes.
 * Source: API Specification V1 Sections 03-21.
 */
export async function registerFounderRoutes(
  server: FastifyInstance,
  deps:   ServerDeps,
): Promise<void> {
  const authenticate = createAuthMiddleware(deps.jwtService);

  const intake        = new IntakeController(deps.commandBus, deps.queryBus);
  const lifecycle     = new LifecycleController(deps.commandBus, deps.queryBus);
  const offer         = new OfferController(deps.commandBus, deps.queryBus);
  const cycle         = new CycleController(deps.commandBus, deps.queryBus);
  const approval      = new ApprovalController(deps.commandBus, deps.queryBus);
  const outcomes      = new OutcomesController(deps.commandBus);
  const campaign      = new CampaignController(deps.commandBus, deps.queryBus);
  const memory        = new MemoryController(deps.queryBus);
  const recalibration = new RecalibrationController(deps.commandBus, deps.queryBus);
  const admin         = new AdminController();

  const prefix = '/v1/founders/me';

  // Apply auth middleware to all founder routes
  server.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/v1/')) {
      await authenticate(request, reply);
    }
  });

  // Intake
  server.get(`${prefix}/intake`,           intake.getStatus.bind(intake));
  server.post(`${prefix}/intake/signals`,  intake.submitSignal.bind(intake));
  server.post(`${prefix}/intake/complete`, intake.complete.bind(intake));

  // Lifecycle
  server.get(`${prefix}`,          lifecycle.getStatus.bind(lifecycle));
  server.post(`${prefix}/pause`,   lifecycle.pause.bind(lifecycle));
  server.post(`${prefix}/resume`,  lifecycle.resume.bind(lifecycle));

  // Offer
  server.get(`${prefix}/offer`,                offer.getOffer.bind(offer));
  server.patch(`${prefix}/offer/availability`, offer.updateAvailability.bind(offer));

  // Cycles
  server.get(`${prefix}/cycles/current`,         cycle.getCurrent.bind(cycle));
  server.get(`${prefix}/cycles/current/brief`,   cycle.getCurrentBrief.bind(cycle));
  server.get(`${prefix}/cycles/current/content`, cycle.getCurrentContent.bind(cycle));
  server.post(`${prefix}/cycles/trigger`,        cycle.trigger.bind(cycle));
  server.get(`${prefix}/cycles/history`,         cycle.getHistory.bind(cycle));

  // Approval
  server.post(`${prefix}/content/:id/approve`,
    approval.approve.bind(approval));
  server.post(`${prefix}/content/:id/edit-and-approve`,
    approval.editAndApprove.bind(approval));
  server.post(`${prefix}/content/:id/reject`,
    approval.reject.bind(approval));

  // Outcomes + signals
  server.post(`${prefix}/outcomes`,         outcomes.report.bind(outcomes));
  server.post(`${prefix}/signals/friday`,   outcomes.fridaySignal.bind(outcomes));

  // Campaigns
  server.post(`${prefix}/campaigns`,
    campaign.launch.bind(campaign));
  server.post(`${prefix}/campaigns/:id/interrupt`,
    campaign.interrupt.bind(campaign));
  server.get(`${prefix}/campaigns/active`,
    campaign.getActive.bind(campaign));

  // Memory
  server.get(`${prefix}/memory`,            memory.getSnapshot.bind(memory));
  server.get(`${prefix}/memory/confidence`, memory.getConfidence.bind(memory));

  // Recalibration
  server.post(`${prefix}/recalibration`,        recalibration.start.bind(recalibration));
  server.get(`${prefix}/recalibration/status`,  recalibration.getStatus.bind(recalibration));

  // Admin (no auth — system endpoint)
  server.get('/admin/status', admin.getSystemStatus.bind(admin));
}
