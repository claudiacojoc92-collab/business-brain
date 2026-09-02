/**
 * Bounded, polite fetch. This reads the founder's OWN site they pointed us at — never
 * arbitrary third-party scraping. Per-request timeout + size cap; text/HTML (or XML for
 * sitemaps) only. One page failing is a gap, never a fabricated read.
 */
const UA = 'BusinessBrainBot/0.1 (+https://businessbrain.ai; website connector; respects robots.txt)';

export interface FetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: string | null;
  error?: string;
}

export async function fetchDocument(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; accept?: string } = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: opts.accept ?? 'text/html,application/xhtml+xml' },
    });
    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      return { ok: false, status: res.status, finalUrl: res.url || url, contentType, body: null, error: `HTTP ${res.status}` };
    }
    // Text-only. Skip media/binary so a large asset can't blow the budget.
    if (contentType && !/text\/html|xml|text\/plain|xhtml/i.test(contentType)) {
      return { ok: false, status: res.status, finalUrl: res.url || url, contentType, body: null, error: `unsupported content-type: ${contentType}` };
    }
    const full = await res.text();
    const body = full.length > maxBytes ? full.slice(0, maxBytes) : full;
    return { ok: true, status: res.status, finalUrl: res.url || url, contentType, body };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message) : String(e);
    return { ok: false, status: 0, finalUrl: url, contentType: null, body: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ── robots.txt (minimal, honest: absent/unreadable → allow) ──────────────────────
export interface RobotsRules { disallow: string[] }

export function parseRobots(txt: string): RobotsRules {
  const disallow: string[] = [];
  let appliesToUs = false;
  for (const line of txt.split('\n')) {
    const l = (line.split('#')[0] ?? '').trim();
    if (!l) continue;
    const idx = l.indexOf(':');
    if (idx === -1) continue;
    const key = l.slice(0, idx).trim().toLowerCase();
    const val = l.slice(idx + 1).trim();
    if (key === 'user-agent') appliesToUs = val === '*';
    else if (key === 'disallow' && appliesToUs && val) disallow.push(val);
  }
  return { disallow };
}

export function isAllowed(rules: RobotsRules, pathname: string): boolean {
  return !rules.disallow.some((rule) => rule === '/' || pathname.startsWith(rule));
}

export async function fetchRobots(origin: string): Promise<RobotsRules> {
  const res = await fetchDocument(`${origin}/robots.txt`, { timeoutMs: 3000, accept: 'text/plain' });
  return res.ok && res.body ? parseRobots(res.body) : { disallow: [] }; // absent/unreadable → allow all
}
