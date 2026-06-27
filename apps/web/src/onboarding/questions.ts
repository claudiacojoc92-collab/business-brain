/**
 * src/onboarding/questions.ts
 *
 * Single source of truth for the 28 Core Interview questions.
 * These map exactly to the B1 spec and the 28 signal_type enum values
 * added in migration V048.
 *
 * Block structure controls when reflection messages appear.
 */

export interface Question {
  signal_type: string;
  prompt: string;
  block: 1 | 2 | 3 | 4 | 5 | 6;
}

export const QUESTIONS: Question[] = [
  // ── Block 1 — Conviction ──────────────────────────────────────────────────
  {
    signal_type: 'CONVICTION_MECHANISM',
    prompt:
      'When you say [the core problem your business solves] — what specifically do most people in your space miss that you see?',
    block: 1,
  },
  {
    signal_type: 'FOUNDING_STORY',
    prompt: 'Describe the moment you first knew this was true. What happened?',
    block: 1,
  },
  {
    signal_type: 'BELIEF_TARGET',
    prompt: 'What belief does your ideal client hold that you think is wrong?',
    block: 1,
  },
  {
    signal_type: 'CONVICTION_FALSIFICATION',
    prompt: 'What would need to happen for you to change your mind about this?',
    block: 1,
  },
  {
    signal_type: 'EDUCATION_INSIGHT',
    prompt:
      'What do you know about your domain that you wish someone had told you 5 years earlier?',
    block: 1,
  },
  {
    signal_type: 'CONTRARIAN_POSITION',
    prompt:
      'What is a belief about your domain that most experts in your space would disagree with?',
    block: 1,
  },

  // ── Block 2 — Voice ───────────────────────────────────────────────────────
  {
    signal_type: 'VOICE_OPENING_EXAMPLE',
    prompt:
      "Write the opening line of a LinkedIn post you would be proud of. Don't edit it — just write.",
    block: 2,
  },
  {
    signal_type: 'VOICE_REJECTION_EXAMPLE',
    prompt:
      "Read this sentence: 'Leverage your existing brand equity to create scalable content architecture.' What is wrong with it?",
    block: 2,
  },
  {
    signal_type: 'VOICE_SYNONYM',
    prompt: "What word do you use instead of 'leverage'?",
    block: 2,
  },
  {
    signal_type: 'VOICE_CTA_EXAMPLE',
    prompt: 'How do you typically end a piece of content? Show me a real example.',
    block: 2,
  },
  {
    signal_type: 'VOICE_ANALOGY',
    prompt:
      'What is a metaphor or analogy you have used more than once? Why does it keep coming back?',
    block: 2,
  },
  {
    signal_type: 'CONTENT_HARD_BLOCK',
    prompt:
      "What topics are off-limits for your content? Not for business reasons — because they feel wrong.",
    block: 2,
  },

  // ── Block 3 — Audience ────────────────────────────────────────────────────
  {
    signal_type: 'AUDIENCE_INTERNAL_MONOLOGUE',
    prompt:
      'What does your ideal client say to themselves about [the problem] before they find you? Write it in their voice.',
    block: 3,
  },
  {
    signal_type: 'AUDIENCE_SOCIAL_FRAMING',
    prompt:
      'What do they say to their peers about this problem? The polite, social version.',
    block: 3,
  },
  {
    signal_type: 'AUDIENCE_SELF_PROTECTION',
    prompt:
      "What do they tell themselves is the reason they haven't solved it yet?",
    block: 3,
  },
  {
    signal_type: 'WARM_SIGNAL_VOCABULARY',
    prompt:
      'What question does a prospective client ask that tells you immediately they are ready?',
    block: 3,
  },
  {
    signal_type: 'COLD_SIGNAL_VOCABULARY',
    prompt: 'What question tells you immediately they are not ready?',
    block: 3,
  },
  {
    signal_type: 'AUDIENCE_FALSE_ASSUMPTION',
    prompt:
      'What is one false assumption your audience holds about your domain that you keep having to correct?',
    block: 3,
  },

  // ── Block 4 — Offer ───────────────────────────────────────────────────────
  {
    signal_type: 'OFFER_NATURAL_LANGUAGE',
    prompt:
      "Describe your offer exactly as you would in a first sales conversation. Don't edit it.",
    block: 4,
  },
  {
    signal_type: 'OFFER_PRICE_PHILOSOPHY',
    prompt: 'What is the price? How did you arrive at that number?',
    block: 4,
  },
  {
    signal_type: 'PRIMARY_OBJECTION',
    prompt: 'What is the most common reason someone decides not to work with you?',
    block: 4,
  },
  {
    signal_type: 'OBJECTION_RESPONSE',
    prompt: 'What do you say in response to that objection?',
    block: 4,
  },

  // ── Block 5 — Approval standard ──────────────────────────────────────────
  {
    signal_type: 'APPROVAL_STANDARD_POSITIVE',
    prompt:
      'Name the best piece of content you have ever published. What made it right?',
    block: 5,
  },
  {
    signal_type: 'APPROVAL_STANDARD_NEGATIVE',
    prompt:
      'Name a piece of content you wish you had not published. What was wrong with it?',
    block: 5,
  },
  {
    signal_type: 'ZERO_EDIT_CRITERIA',
    prompt:
      'When you approve a piece without edits, what did it have that made it right?',
    block: 5,
  },
  {
    signal_type: 'INTENDED_AUDIENCE_MOVEMENT',
    prompt:
      'What question do you want your content to make your audience ask themselves?',
    block: 5,
  },

  // ── Block 6 — Direct feedback ─────────────────────────────────────────────
  {
    signal_type: 'UNSOLICITED_HIGH_VALUE',
    prompt:
      "What is the one thing about your business that you haven't told Business Brain yet that would make the briefs significantly better?",
    block: 6,
  },
  {
    signal_type: 'TRUST_CRITERIA',
    prompt:
      'What would a Business Brain brief need to do consistently to make you trust it completely?',
    block: 6,
  },
];

export const REFLECTIONS: Record<number, string> = {
  1: "You have a clear point of view. That's what good content is built on.",
  2: "I'm already getting a sense of how you sound.",
  3: "Your audience is very specific. That's good — specific content outperforms general content.",
  4: 'I have a clear picture of your offer and what stands between you and a yes.',
  5: "I know your standard now. I'll hold myself to it.",
  // No reflection after block 6 — goes straight to completion
};

export const TOTAL_QUESTIONS = QUESTIONS.length; // 28

export function getBlock(index: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return QUESTIONS[index].block;
}

export function isLastInBlock(index: number): boolean {
  const currentBlock = QUESTIONS[index].block;
  const nextBlock = index + 1 < QUESTIONS.length ? QUESTIONS[index + 1].block : null;
  return nextBlock === null || nextBlock !== currentBlock;
}
