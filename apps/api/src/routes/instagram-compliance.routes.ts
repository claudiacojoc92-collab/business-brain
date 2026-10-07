import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseSignedRequest } from '../connectors/instagram/signed-request';
import {
  getInstagramComplianceStore,
  confirmationCodeFor,
  type DeletionStatus,
} from '../connectors/instagram/instagram-compliance.store';

/**
 * Instagram compliance endpoints (Meta App Review requirement — separate from the OAuth redirect):
 *
 *   POST /api/sources/instagram/deauthorize          — user removed the app → revoke + purge
 *   POST /api/sources/instagram/data-deletion         — data-deletion request → purge + confirmation
 *   GET  /api/sources/instagram/data-deletion/status  — public deletion-status page (no auth, no PII)
 *
 * Both POSTs authenticate the request by VERIFYING Meta's signed_request against INSTAGRAM_APP_SECRET
 * (constant-time HMAC-SHA256); an invalid/absent signature is rejected 400 and never mutates data.
 * Both are idempotent — deletion of already-removed rows is a no-op and the audit row upserts by a
 * deterministic confirmation code. Nothing here logs a token, a caption, or the signed_request.
 */
export function registerInstagramComplianceRoutes(server: FastifyInstance): void {
  const appSecret = process.env['INSTAGRAM_APP_SECRET'] ?? '';
  const publicBase = (process.env['APP_ORIGIN'] ?? 'https://app.getbusinessbrain.com').replace(/\/$/, '');
  const contact = process.env['PRIVACY_CONTACT_EMAIL'] ?? 'privacy@getbusinessbrain.com';

  // Meta POSTs signed_request as application/x-www-form-urlencoded; Fastify parses only JSON by default.
  if (!server.hasContentTypeParser('application/x-www-form-urlencoded')) {
    server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try {
        const obj: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(typeof body === 'string' ? body : '')) obj[k] = v;
        done(null, obj);
      } catch (e) {
        done(e instanceof Error ? e : new Error('form parse error'), undefined);
      }
    });
  }

  const extractSignedRequest = (request: FastifyRequest): string => {
    const b = request.body as Record<string, unknown> | undefined;
    if (b && typeof b['signed_request'] === 'string') return b['signed_request'];
    const q = request.query as Record<string, unknown> | undefined;
    if (q && typeof q['signed_request'] === 'string') return q['signed_request'];
    return '';
  };

  const statusUrlFor = (code: string): string =>
    `${publicBase}/api/sources/instagram/data-deletion/status?code=${encodeURIComponent(code)}`;

  const guard = (reply: FastifyReply): boolean => {
    if (!appSecret) { void reply.code(503).send({ error: 'instagram compliance not configured', need: ['INSTAGRAM_APP_SECRET'] }); return false; }
    if (!getInstagramComplianceStore()) { void reply.code(503).send({ error: 'instagram compliance store unavailable', need: ['DATABASE_URL'] }); return false; }
    return true;
  };

  // ── Deauthorize callback ────────────────────────────────────────────────────────────────────────
  server.post('/api/sources/instagram/deauthorize', async (request, reply) => {
    if (!guard(reply)) return;
    const payload = parseSignedRequest(extractSignedRequest(request), appSecret);
    if (!payload) return reply.code(400).send({ error: 'invalid signed_request' });
    const store = getInstagramComplianceStore()!;
    const founderId = await store.resolveFounder(payload.userId);
    if (founderId) await store.deleteInstagramData(founderId);
    const code = confirmationCodeFor(payload.userId);
    await store.recordRequest({ confirmationCode: code, kind: 'deauthorize', igUserId: payload.userId, founderId, status: 'completed' });
    request.log.info({ event: 'ig_deauthorize', matched: Boolean(founderId) }, 'instagram deauthorize processed');
    return reply.code(200).send({ ok: true });
  });

  // ── Data-deletion request callback ──────────────────────────────────────────────────────────────
  server.post('/api/sources/instagram/data-deletion', async (request, reply) => {
    if (!guard(reply)) return;
    const payload = parseSignedRequest(extractSignedRequest(request), appSecret);
    if (!payload) return reply.code(400).send({ error: 'invalid signed_request' });
    const store = getInstagramComplianceStore()!;
    const code = confirmationCodeFor(payload.userId);
    const founderId = await store.resolveFounder(payload.userId);
    if (founderId) await store.deleteInstagramData(founderId);
    await store.recordRequest({ confirmationCode: code, kind: 'data_deletion', igUserId: payload.userId, founderId, status: 'completed' });
    request.log.info({ event: 'ig_data_deletion', matched: Boolean(founderId) }, 'instagram data-deletion processed');
    // Meta's required response shape.
    return reply.code(200).send({ url: statusUrlFor(code), confirmation_code: code });
  });

  // GET variants: safe, read-only acknowledgements (Meta pings / manual checks) — never mutate.
  const ack = (endpoint: string) => async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(200).send({ ok: true, endpoint, method: 'POST', field: 'signed_request' });
  server.get('/api/sources/instagram/deauthorize', ack('instagram-deauthorize'));
  server.get('/api/sources/instagram/data-deletion', ack('instagram-data-deletion'));

  // ── Public deletion-status page (no auth, no personal data) ─────────────────────────────────────
  server.get('/api/sources/instagram/data-deletion/status', async (request, reply) => {
    const code = String((request.query as Record<string, unknown>)['code'] ?? '');
    const store = getInstagramComplianceStore();
    const status = store && code ? await store.getStatus(code) : null;
    void reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(renderStatusPage(code, status, contact));
  });
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Static, public HTML — exposes only the (non-reversible) confirmation code, status, and contact. */
function renderStatusPage(code: string, status: DeletionStatus | null, contact: string): string {
  const safeCode = esc(code);
  const safeContact = esc(contact);
  let heading: string;
  let detail: string;
  if (!code) {
    heading = 'Deletion status';
    detail = 'No confirmation code was provided. Append <code>?code=YOUR_CODE</code> to this URL to check a request.';
  } else if (!status) {
    heading = 'No matching request';
    detail = `We have no deletion request on record for confirmation code <code>${safeCode}</code>.`;
  } else if (status.status === 'completed') {
    const kind = status.kind === 'deauthorize' ? 'app deauthorization' : 'data-deletion request';
    heading = 'Deletion complete';
    detail = `Your ${esc(kind)} has been processed. All Instagram data associated with this connection — access credentials, imported posts and captions, and any analysis derived from them — has been permanently deleted from Business Brain.`;
  } else {
    heading = 'Deletion in progress';
    detail = 'Your request has been received and is being processed.';
  }
  const requested = status?.requestedAt ? esc(status.requestedAt) : null;
  const completed = status?.completedAt ? esc(status.completedAt) : null;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Business Brain — Data Deletion Status</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px;
         margin: 0 auto; padding: 48px 24px; color: #1f2937; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #0b0f14; } code { background: #1f2937; } }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .brand { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin: 0 0 24px; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px 22px; }
  @media (prefers-color-scheme: dark) { .card { border-color: #374151; } }
  code { background: #f3f4f6; padding: 1px 6px; border-radius: 5px; font-size: 14px; }
  dl { margin: 16px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; font-size: 14px; }
  dt { color: #6b7280; } dd { margin: 0; }
  .foot { margin-top: 24px; font-size: 14px; color: #6b7280; }
  a { color: inherit; }
</style></head>
<body>
  <p class="brand">Business Brain</p>
  <div class="card">
    <h1>${esc(heading)}</h1>
    <p>${detail}</p>
    <dl>
      ${code ? `<dt>Confirmation code</dt><dd><code>${safeCode}</code></dd>` : ''}
      ${status ? `<dt>Status</dt><dd>${esc(status.status)}</dd>` : ''}
      ${requested ? `<dt>Requested</dt><dd>${requested}</dd>` : ''}
      ${completed ? `<dt>Completed</dt><dd>${completed}</dd>` : ''}
    </dl>
  </div>
  <p class="foot">Questions about your data? Contact <a href="mailto:${safeContact}">${safeContact}</a>.</p>
</body></html>`;
}
