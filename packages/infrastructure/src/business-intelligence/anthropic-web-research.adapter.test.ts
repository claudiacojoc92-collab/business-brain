import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

const create = vi.fn();
vi.mock('../llm/anthropic-client', () => ({ createAnthropicClient: () => ({ messages: { create } }) }));

import { parseSearchResponse, parseFetchResponse, AnthropicWebResearchAdapter } from './anthropic-web-research.adapter';

type Block = Anthropic.Messages.ContentBlock;
const caller = { type: 'direct' } as const;
const use = (name: 'web_search' | 'web_fetch', input: unknown) => ({ type: 'server_tool_use', id: 'srvtoolu_1', name, input, caller }) as unknown as Block;

describe('parseSearchResponse (strategic moves, web research)', () => {
  it('returns url, title and page age per hit, and the query the provider actually ran; snippets are never exposed', () => {
    const content = [
      use('web_search', { query: 'studio fitness Cluj-Napoca gravide' }),
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', caller, content: [
        { type: 'web_search_result', url: 'https://example.ro/prenatal', title: ' Yoga prenatal Cluj ', page_age: '2 weeks ago', encrypted_content: 'ENC' },
        { type: 'web_search_result', url: '', title: 'no url', page_age: null, encrypted_content: 'ENC' },
      ] },
      { type: 'text', text: 'DONE', citations: null },
    ] as unknown as Block[];
    const out = parseSearchResponse('studio fitness Cluj-Napoca gravide', { city: 'Cluj-Napoca', timezone: 'Europe/Bucharest' }, content);
    expect(out.error).toBeNull();
    expect(out.location).toEqual({ city: 'Cluj-Napoca', timezone: 'Europe/Bucharest' });
    expect(out.executedQuery).toBe('studio fitness Cluj-Napoca gravide');
    expect(out.hits).toEqual([{ url: 'https://example.ro/prenatal', title: 'Yoga prenatal Cluj', pageAge: '2 weeks ago' }]);
    expect(JSON.stringify(out)).not.toContain('ENC');
  });

  it('a provider error comes back as its code, with no hits', () => {
    const content = [use('web_search', { query: 'q' }), { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', caller, content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } }] as unknown as Block[];
    expect(parseSearchResponse('q', null, content)).toMatchObject({ hits: [], error: 'too_many_requests' });
  });

  it('a model that answered without searching is "no_search", never treated as results', () => {
    const content = [{ type: 'text', text: 'Here are some studios…', citations: null }] as unknown as Block[];
    expect(parseSearchResponse('q', null, content)).toMatchObject({ hits: [], error: 'no_search', executedQuery: null, location: null });
  });
});

describe('parseFetchResponse (strategic moves, web research)', () => {
  const fetched = (source: unknown, title: string | null = 'Page') => [
    use('web_fetch', { url: 'https://example.ro/a' }),
    { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1', caller, content: { type: 'web_fetch_result', url: 'https://example.ro/a', retrieved_at: '2026-10-14T10:00:00Z', content: { type: 'document', title, citations: null, source } } },
  ] as unknown as Block[];

  it('returns the page text, title and retrieval time', () => {
    const out = parseFetchResponse('https://example.ro/a', fetched({ type: 'text', media_type: 'text/plain', data: 'Cursuri prenatale în Cluj.' }));
    expect(out).toEqual({ url: 'https://example.ro/a', ok: true, title: 'Page', text: 'Cursuri prenatale în Cluj.', kind: 'text', retrievedAt: '2026-10-14T10:00:00Z', error: null });
  });

  it('a blocked page (403-style) is an error code with no text', () => {
    const content = [use('web_fetch', { url: 'https://x.ro' }), { type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1', caller, content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } }] as unknown as Block[];
    expect(parseFetchResponse('https://x.ro', content)).toMatchObject({ ok: false, text: '', kind: 'none', error: 'url_not_accessible' });
  });

  it('an empty page is not ok (nothing to quote)', () => {
    expect(parseFetchResponse('https://example.ro/a', fetched({ type: 'text', media_type: 'text/plain', data: '   ' }))).toMatchObject({ ok: false, error: 'empty_page' });
  });

  it('a PDF is fetched but carries no text here', () => {
    expect(parseFetchResponse('https://example.ro/a', fetched({ type: 'base64', media_type: 'application/pdf', data: 'JVBER' }))).toMatchObject({ ok: true, kind: 'pdf', text: '' });
  });

  it('no fetch happened → "no_fetch"', () => {
    expect(parseFetchResponse('https://example.ro/a', [{ type: 'text', text: 'DONE', citations: null }] as unknown as Block[])).toMatchObject({ ok: false, error: 'no_fetch' });
  });
});

describe('AnthropicWebResearchAdapter.search request shape (2026-10-14: "Country code RO is not supported")', () => {
  beforeEach(() => { create.mockReset(); create.mockResolvedValue({ content: [] }); });
  const toolOf = () => (create.mock.calls[0]![0] as { tools: Record<string, unknown>[] }).tools[0]!;

  it('sends city + timezone, never a country code', async () => {
    await new AnthropicWebResearchAdapter('k', 'm').search('q', { location: { city: 'Cluj-Napoca', timezone: 'Europe/Bucharest' } });
    expect(toolOf()['user_location']).toEqual({ type: 'approximate', city: 'Cluj-Napoca', timezone: 'Europe/Bucharest' });
    expect(JSON.stringify(toolOf())).not.toContain('country');
  });

  it('a half-known location (city without timezone) sends no location at all', async () => {
    await new AnthropicWebResearchAdapter('k', 'm').search('q', { location: { city: 'Cluj-Napoca', timezone: ' ' } });
    expect(toolOf()).not.toHaveProperty('user_location');
  });

  it('no location → no user_location (the case that works without one)', async () => {
    const out = await new AnthropicWebResearchAdapter('k', 'm').search('q');
    expect(toolOf()).not.toHaveProperty('user_location');
    expect(out.location).toBeNull();
  });

  it('a rejected request comes back as an error code with its status, not an exception', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('Country code RO is not supported.'), { status: 400 }));
    const out = await new AnthropicWebResearchAdapter('k', 'm').search('q');
    expect(out).toMatchObject({ hits: [], error: 'request_failed_400' });
  });
});
