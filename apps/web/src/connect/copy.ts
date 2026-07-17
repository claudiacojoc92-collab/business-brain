/**
 * Every founder-visible string for the connect surface (S1-T5b), in one auditable place. Language Blueprint:
 * quiet, precise, non-persuasive, non-sales. No unlock/maximize/complete/improve/AI-powered/recommended/
 * best-practice/great-job, no progress %, no "missing", no "you should connect"/"connect everything", no
 * gamification/urgency, no exclamation. "Connect what you have" — every source stands on its own.
 */
export const CONNECT_COPY = {
  title: 'Connect your sources.',
  intro: 'Connect what you have. Each source stands on its own — a website, a document, your calendar.',
  // A calm, factual note that re-connecting refreshes a source (replaces the prior read) — neither alarm nor silence.
  refreshNote: 'Connecting again refreshes this source.',
  yourReads: 'Your Reads',

  website: {
    title: 'Website',
    field: 'Your website address',
    action: 'Connect',
    connecting: 'Connecting…',
    connected: (n: number) => `Connected · ${n} ${n === 1 ? 'page' : 'pages'}`,
    error: "I couldn't reach that site.",
  },
  upload: {
    title: 'Document',
    field: 'Choose a document',
    action: 'Upload',
    connecting: 'Reading your document…',
    connected: (n: number) => `Connected · ${n} ${n === 1 ? 'section' : 'sections'}`,
    tooLarge: 'That file is too large.',
    unsupported: "I can't read that type yet.",
  },
  calendar: {
    title: 'Calendar',
    action: 'Connect calendar',
    reading: 'Reading your calendar…',
    connected: 'Connected',
    disconnect: 'Disconnect',
    unavailable: 'Calendar connection isn’t available right now.',
  },

  generate: {
    action: 'Generate a Read',
    disabled: 'Connect a source to generate a Read.',
    loading: 'Generating your Read…',
    insufficient: "Based on what you've connected, there isn't enough grounded material yet.",
    error: 'Something went wrong. Please try again.',
    // RJ-1 — generation failed on OUR side (the engine returned an unusable result). Distinct from
    // `insufficient` on purpose: the founder's sources are fine, so we must not imply otherwise, must
    // not ask them to connect more, and must not claim a Read exists. Nothing was saved.
    failed: "I couldn't complete your Read. That's a problem on my side, not with your sources. Nothing was saved — you can try again.",
  },
} as const;
