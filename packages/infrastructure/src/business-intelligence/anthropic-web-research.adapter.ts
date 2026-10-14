import type Anthropic from '@anthropic-ai/sdk';
import type { IWebResearchPort, WebSearchOptions, WebSearchOutcome, FetchedPage, SearchLocation } from '@bb/application';
import { createAnthropicClient } from '../llm/anthropic-client';

/**
 * Strategic Moves — web research through Anthropic's server-side tools (intent/2026-10-14-strategic-moves).
 *
 * Two mechanical calls, each allowed exactly ONE tool use, so what comes back is the provider's raw result, not a
 * model's summary of it:
 *   - search: `web_search_20250305` → url, title, page age. The provider's snippet arrives encrypted and is dropped,
 *     so a snippet can never be cited as evidence.
 *   - fetch: `web_fetch_20250910` → the page's own plain text, the only thing a move may quote.
 * The basic tool versions are used on purpose: the newer ones filter results with model-written code, and the
 * pipeline needs the unfiltered list. Failures come back as an error code, never as an exception, so one bad page
 * cannot fail a run.
 * Location is city + timezone only, never `country`: the provider rejects some codes for the whole request ("Country
 * code RO is not supported", 400) and ignores others for a local-language query (diagnostic, 2026-10-14).
 */
const FETCH_MAX_CONTENT_TOKENS = 12_000;

const SEARCH_SYSTEM = 'You run web searches for a research pipeline. Call web_search exactly once with the user message as the query, '
  + 'exactly as written (same words, same language). Then reply with the single word DONE. Do not answer or summarise.';
const FETCH_SYSTEM = 'You fetch pages for a research pipeline. Call web_fetch exactly once on the URL in the user message, unchanged. '
  + 'Then reply with the single word DONE. Do not summarise the page.';

type Block = Anthropic.Messages.ContentBlock;

/** The search response → hits. Pure (tested without the network). */
export function parseSearchResponse(query: string, location: SearchLocation | null, content: readonly Block[]): WebSearchOutcome {
  const use = content.find((b): b is Anthropic.Messages.ServerToolUseBlock => b.type === 'server_tool_use' && b.name === 'web_search');
  const input = (use?.input ?? null) as { query?: unknown } | null;
  const executedQuery = typeof input?.query === 'string' ? input.query : null;
  const result = content.find((b): b is Anthropic.Messages.WebSearchToolResultBlock => b.type === 'web_search_tool_result');
  if (!result) return { query, executedQuery, location, hits: [], error: 'no_search' };
  if (!Array.isArray(result.content)) return { query, executedQuery, location, hits: [], error: result.content.error_code };
  const hits = result.content
    .filter((r) => typeof r.url === 'string' && r.url.trim())
    .map((r) => ({ url: r.url, title: (r.title ?? '').trim(), pageAge: r.page_age ?? null }));
  return { query, executedQuery, location, hits, error: null };
}

/** The fetch response → the page's text. Pure (tested without the network). */
export function parseFetchResponse(url: string, content: readonly Block[]): FetchedPage {
  const result = content.find((b): b is Anthropic.Messages.WebFetchToolResultBlock => b.type === 'web_fetch_tool_result');
  const none = (error: string): FetchedPage => ({ url, ok: false, title: null, text: '', kind: 'none', retrievedAt: null, error });
  if (!result) return none('no_fetch');
  if (result.content.type === 'web_fetch_tool_result_error') return none(result.content.error_code);
  const doc = result.content.content;
  const source = doc.source;
  const text = source.type === 'text' ? source.data : '';
  return {
    url: result.content.url || url,
    ok: source.type === 'text' ? text.trim().length > 0 : true,
    title: doc.title ?? null,
    text,
    kind: source.type === 'text' ? 'text' : 'pdf',
    retrievedAt: result.content.retrieved_at ?? null,
    error: source.type === 'text' && !text.trim() ? 'empty_page' : null,
  };
}

export class AnthropicWebResearchAdapter implements IWebResearchPort {
  private readonly modelId: string;
  constructor(private readonly apiKey: string, modelId?: string) {
    this.modelId = modelId ?? process.env['LLM_STRONG_MODEL'] ?? 'claude-sonnet-4-6';
  }

  async search(query: string, opts: WebSearchOptions = {}): Promise<WebSearchOutcome> {
    const city = opts.location?.city?.trim() ?? '';
    const timezone = opts.location?.timezone?.trim() ?? '';
    // Both or nothing: a half-known location is not sent (no location works; a wrong one skews results).
    const location: SearchLocation | null = city && timezone ? { city, timezone } : null;
    try {
      const client = createAnthropicClient(this.apiKey);
      const resp = await client.messages.create({
        model: this.modelId, max_tokens: 512, temperature: 0, system: SEARCH_SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1, ...(location ? { user_location: { type: 'approximate' as const, city: location.city, timezone: location.timezone } } : {}) }],
        messages: [{ role: 'user', content: query }],
      });
      return parseSearchResponse(query, location, resp.content);
    } catch (e) {
      return { query, executedQuery: null, location, hits: [], error: requestFailed(e) };
    }
  }

  async fetch(url: string): Promise<FetchedPage> {
    try {
      const client = createAnthropicClient(this.apiKey);
      const resp = await client.messages.create({
        model: this.modelId, max_tokens: 512, temperature: 0, system: FETCH_SYSTEM,
        tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 1, max_content_tokens: FETCH_MAX_CONTENT_TOKENS }],
        messages: [{ role: 'user', content: url }],
      });
      return parseFetchResponse(url, resp.content);
    } catch (e) {
      return { url, ok: false, title: null, text: '', kind: 'none', retrievedAt: null, error: requestFailed(e) };
    }
  }
}

/** A thrown request (after the SDK's own retries) as an error code: the HTTP status when there is one. */
function requestFailed(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? `request_failed_${status}` : 'request_failed';
}
