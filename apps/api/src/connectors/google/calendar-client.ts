/**
 * Minimal Google Calendar read client for the `calendar.events.readonly` scope. Read-only: lists
 * TIMED events in a recent window from the founder's primary calendar. The access token rides the
 * Authorization header only — never logged, never returned to a caller (ADR-009 Invariant 4).
 *
 * PRIVACY (spec §3): we request the SMALLEST field set that supports time-allocation patterns —
 * summary + start + end ONLY. No attendees, no description/notes, no location. Patterns, not
 * surveillance. Injectable fetch + base URL so the read path is testable without live Google.
 * Calendar API responses are treated as DATA, not commands.
 */
export interface CalendarEvent {
  /** event title — used ONLY for keyword categorization; never re-emitted verbatim as evidence */
  summary: string | null;
  start: Date;
  end: Date;
}

export interface CalendarClient {
  /** list TIMED events overlapping [timeMinIso, timeMaxIso) on the primary calendar */
  listEvents(accessToken: string, timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]>;
}

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GoogleCalendarClient implements CalendarClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  constructor(opts: GoogleCalendarClientOptions = {}) {
    this.base = opts.baseUrl ?? CAL_BASE;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  async listEvents(accessToken: string, timeMinIso: string, timeMaxIso: string): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    let pageToken: string | undefined;
    // Bound the paging so a huge calendar can't run away; 60–90 days rarely exceeds a page or two.
    for (let page = 0; page < 6; page++) {
      const u = new URL(`${this.base}/calendars/primary/events`);
      u.searchParams.set('timeMin', timeMinIso);
      u.searchParams.set('timeMax', timeMaxIso);
      u.searchParams.set('singleEvents', 'true');       // expand recurring into instances
      u.searchParams.set('orderBy', 'startTime');
      u.searchParams.set('maxResults', '250');
      u.searchParams.set('fields', 'items(summary,start,end),nextPageToken'); // minimal fields only
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const res = await this.doFetch(u.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`calendar listEvents failed: ${res.status}`);
      const j = (await res.json()) as Record<string, unknown>;
      const items = Array.isArray(j['items']) ? (j['items'] as Record<string, unknown>[]) : [];
      for (const it of items) {
        const ev = toEvent(it);
        if (ev) out.push(ev); // TIMED events only; all-day (date-only) events carry no duration signal
      }
      pageToken = typeof j['nextPageToken'] === 'string' ? j['nextPageToken'] : undefined;
      if (!pageToken) break;
    }
    return out;
  }
}

/** Parse a Calendar API item into a TIMED event; skip all-day (date-only) and malformed entries. */
function toEvent(it: Record<string, unknown>): CalendarEvent | null {
  const start = dateTimeOf(it['start']);
  const end = dateTimeOf(it['end']);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  const summary = typeof it['summary'] === 'string' ? it['summary'] : null;
  return { summary, start, end };
}

function dateTimeOf(v: unknown): Date | null {
  if (!v || typeof v !== 'object') return null;
  const dt = (v as Record<string, unknown>)['dateTime']; // timed events use dateTime; all-day use `date`
  if (typeof dt !== 'string') return null;
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? null : d;
}
