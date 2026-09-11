import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server';
import { registerHealthRoutes }        from './health.routes';
import { registerAuthRoutes }          from './auth.routes';
import { registerFounderRoutes }       from './founder.routes';
import { registerM21DevRoutes }        from './m21-dev.routes';
import { registerM22DevRoutes }        from './m22-dev.routes';
import { registerGoogleDevRoutes }     from './google-dev.routes';
import { registerDeclaredDevRoutes }   from './declared-dev.routes';
import { registerSocialSourcesRoutes } from './social-sources.routes';
import { registerInstagramComplianceRoutes } from './instagram-compliance.routes';
import { registerBusinessBrainRoutes } from './businessbrain.routes';
import { registerBusinessRoutes } from './businesses.routes';
import { registerBusinessIntelligenceRoutes } from './business-intelligence.routes';
import { registerBusinessUnderstandingRoutes } from './business-understanding.routes';
import { registerConversationRoutes } from './conversation.routes';
import { registerEventsRoutes } from './events.routes';
import { registerStrategyRoutes } from './strategy.routes';
import { registerVoiceRoutes } from './voice.routes';
import { registerPlanRoutes } from './plan.routes';
import { registerCarouselRoutes } from './carousel.routes';
import { registerPhotoLedRoutes } from './photoled.routes';
import { registerReelRoutes } from './reel.routes';
import { registerReelShootRoutes } from './reel-shoot.routes';
import { registerGoogleSigninRoutes } from './google-signin.routes';

/**
 * Registers all routes. Each route module is self-contained.
 * Source: Repository Structure V1 Section 02.
 */
export async function registerRoutes(
  server: FastifyInstance,
  deps:   ServerDeps,
): Promise<void> {
  registerHealthRoutes(server);
  registerAuthRoutes(server, deps);
  // Google ACCOUNT sign-in (pre-auth, outside /v1). Separate from the Google data connector.
  registerGoogleSigninRoutes(server, deps);
  await registerFounderRoutes(server, deps);

  // Slice 0 — Business + Membership + account routes (/v1, JWT via the global preHandler).
  registerBusinessRoutes(server, deps);
  // Slice 1 — "BB learned my business": website understanding + Aha (/v1, JWT).
  registerBusinessIntelligenceRoutes(server, deps);
  // M2 — Business Understanding: founder corrections (reuses the real founder_state path; /v1, JWT).
  registerBusinessUnderstandingRoutes(server, deps);
  // Slice 2 — "BB understood me": founder conversation + founder model + Aha 2 (/v1, JWT).
  registerConversationRoutes(server, deps);
  registerEventsRoutes(server, deps); // M7 founder-test telemetry
  // Slice 3 — "BB gave me a real strategy": Strategy Proposal → adopt → Current (/v1, JWT).
  registerStrategyRoutes(server, deps);
  // Slice 4 — "BB learned my voice": example-grounded voice calibration (/v1, JWT).
  registerVoiceRoutes(server, deps);
  registerPlanRoutes(server, deps);       // Slice 5
  registerCarouselRoutes(server, deps);   // Slice 6
  registerPhotoLedRoutes(server, deps);   // Slice 6.1 — Create from Photos
  registerReelRoutes(server, deps);       // Slice 7 V1 — Reel Creation (real MP4)
  registerReelShootRoutes(server, deps);  // Slice 7 V2 — Tell me what to film

  // Social sources — the REAL authenticated Meta/Instagram connect flows (App Review). Present in EVERY
  // build (including production) so a reviewer reaches them through the normal product, not a dev route.
  registerSocialSourcesRoutes(server, deps);

  // Instagram compliance (Meta App Review): Deauthorize + Data-Deletion callbacks + public status page.
  // Present in EVERY build — Meta calls these directly, unauthenticated but signed_request-verified.
  registerInstagramComplianceRoutes(server);

  // Business Brain V1 — versioned lifecycle public API (Phase 6). Present in every build.
  registerBusinessBrainRoutes(server, deps);

  // Dev-only M2.1/M2.2 streaming endpoints (no auth; outside /v1). Never in production.
  if (process.env['NODE_ENV'] !== 'production') {
    registerM21DevRoutes(server);
    await registerM22DevRoutes(server);
    registerGoogleDevRoutes(server); // Google authenticated Source — Phase 1 (OAuth lifecycle)
    registerDeclaredDevRoutes(server); // Capability B v1 — declared intent capture
  }
}
