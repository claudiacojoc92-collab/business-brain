/**
 * STRATEGIC MOVES — the web research port (intent/2026-10-14-strategic-moves).
 *
 * BB otherwise reads only the founder's own material. This port is the one way it looks OUTSIDE: a web search that
 * returns where to look (url, title, page age; never a snippet as evidence) and a fetch that returns the page's own
 * text, which is the only thing a move may quote. What comes back here is external evidence: it is never linked to
 * the business and never enters the understanding or the strategy.
 */

/** One search hit: where to look. The provider's snippet is not exposed, so it can never be cited as evidence. */
export interface WebSearchHit {
  readonly url: string;
  readonly title: string;
  /** The provider's age hint for the page ("2 weeks ago", a date), or null. A freshness signal, not a fact. */
  readonly pageAge: string | null;
}

/**
 * Where to localise results. City + IANA timezone only: never a country code. The provider rejects some (e.g. 'RO':
 * "Country code RO is not supported", 400 for the whole request) and ignores others when the query is in the local
 * language (2026-10-14 diagnostic). Unknown city or timezone → no location at all, which works.
 */
export interface SearchLocation {
  readonly city: string;
  readonly timezone: string;
}

export interface WebSearchOptions {
  readonly location?: SearchLocation;
}

export interface WebSearchOutcome {
  /** The query we asked for. */
  readonly query: string;
  /** The query the provider actually ran (it can differ), or null when no search ran. */
  readonly executedQuery: string | null;
  /** The location sent with the search, or null when none was. */
  readonly location: SearchLocation | null;
  readonly hits: WebSearchHit[];
  /** A provider error code ('unavailable', 'too_many_requests', 'no_search', …), or null. Empty hits + null = no results. */
  readonly error: string | null;
}

/** A fetched page: its own text, the only thing a move may quote. */
export interface FetchedPage {
  readonly url: string;
  readonly ok: boolean;
  readonly title: string | null;
  /** The page's plain text ('' for a PDF or a failure). */
  readonly text: string;
  readonly kind: 'text' | 'pdf' | 'none';
  /** ISO 8601 time the provider retrieved it, or null. */
  readonly retrievedAt: string | null;
  /** A provider error code ('url_not_accessible', 'unsupported_content_type', 'no_fetch', …), or null. */
  readonly error: string | null;
}

export interface IWebResearchPort {
  search(query: string, opts?: WebSearchOptions): Promise<WebSearchOutcome>;
  fetch(url: string): Promise<FetchedPage>;
}
