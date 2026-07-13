import type { SectionId } from './types';

/**
 * Every founder-visible string for the Read surface, in one auditable place (Language Blueprint: precise,
 * quiet, grounded, verdict-free, non-emotional — no hype, no directive, no exclamation). The surface OWNS
 * the section headers by section id (the API's section.title is an internal label); this keeps founder copy
 * Blueprint-compliant and stable.
 */
export const SECTION_TITLES: Record<SectionId, string> = {
  what_i_read: 'What I Read',
  what_i_observe: 'What I Observe',
  gaps: 'Where Your Story and Evidence Diverge',
  bets: "What You're Betting On",
  my_read: 'My Read',
  cannot_see: 'What I Cannot See Yet',
};

/** Quiet, honest empty-section copy. */
export const EMPTY_COPY: Partial<Record<SectionId, string>> = {
  // S4 states the PRINCIPLE of a bet — no "yet", no coming-soon, no pressure to create content.
  bets: "A bet is a wager you're choosing to make — something you name, not something the instrument infers for you.",
  my_read: 'No read to offer yet.',
  what_i_observe: 'Nothing here I can ground in what I read.',
  gaps: 'Nothing where your story and your evidence pull apart.',
  what_i_read: 'No sources read.',
};

/** Page-level states. */
export const STATE_COPY = {
  loading: 'Loading this Read.',
  notFound: "This Read isn't available.",
  corrupt: "This Read can't be shown.",
};

/** Founder-facing source names for S6 (factual source metadata, not internal enums). */
const SOURCE_LABEL: Record<string, string> = {
  website: 'your website',
  upload: 'your uploaded documents',
  google: 'your Google account',
  'google-calendar': 'your calendar',
};

/**
 * Absent-source limit copy — INSTRUMENT-phrased. The blindness belongs to the instrument ("I haven't read
 * anything from…"), NEVER to the founder ("you're missing…") and NEVER a prompt to connect. Other limit
 * kinds (engine_rejected / ceiling) render their stored detail verbatim.
 */
export function absentSourceLine(source: string | undefined): string {
  const label = (source && SOURCE_LABEL[source]) ?? 'some of your sources';
  return `I haven't read anything from ${label}, so there's a part of your business I can't speak to.`;
}
