/**
 * Act I — Milestone 1 fixtures (the ONLY data source for M1).
 *
 * One coherent founder (the "Marketing Clarity" sample from the committed prototype
 * apps/web/design/act-one-editorial.html). Copy and pacing are taken from that
 * prototype verbatim — nothing here is invented. Everything is fixture data EXCEPT
 * the founder's Conversation answer, which is captured live at runtime and echoed
 * into the Gift (the one live coupling in M1); `conversationFixtureAnswer` below is a
 * placeholder sample only and is NOT used for the echo.
 */
import type { EvidenceData, GiftDraft, Rich, WeekItem } from './types';

// ── Reveal timing (ms) — matched to the prototype's say()/wait() pacing ──────────
export const TIMING = {
  enter: 1050,        // .say fade/settle (prototype: 1.05s)
  word: 82,           // per-word compose stagger (prototype composeWords)
  recedeAfter: 850,   // delay before irrelevant evidence recedes
  brightAfter: 550,   // delay after recede before relevant brightens
  brightStagger: 250, // per-item brighten stagger
  beat: 800,          // pause between a settled line and the next beat
} as const;

// Pause after each contact/narration line, mirroring the prototype's per-line waits.
export const contactLines: ReadonlyArray<{ rich: Rich; kind: 'big' | 'med' | 'admit'; pause: number }> = [
  {
    kind: 'big',
    pause: 1850,
    rich: ["Most founders I'm built for are remarkable at the work — and worn down by the marketing."],
  },
  {
    kind: 'med',
    pause: 2050,
    rich: [
      "You've likely lived the cycle: business comes from referrals until it doesn't, then it's ",
      { em: 'post more' },
      ", and the posting never quite sounds like you.",
    ],
  },
  {
    kind: 'admit',
    pause: 1500,
    rich: [
      'I understand businesses ',
      { b: 'like' },
      " yours. I don't yet understand ",
      { b: 'yours' },
      " — and I won't pretend to. Let's begin there.",
    ],
  },
];

export const connect = {
  kicker: 'Open the door',
  line: "Connect what's already public. I'll read — no questions yet.",
  sources: ['Website', 'Instagram', 'LinkedIn', 'Newsletter', 'YouTube', 'Calendar'],
  button: 'Let me read',
  hintEmpty: 'connect at least one',
  hintCount: (n: number) => `${n} connected`,
} as const;

export const analyzingLine = 'Give me a moment with it.';

export const evidence: ReadonlyArray<EvidenceData> = [
  { key: 'site', source: 'website',  relevant: false, pos: { left: '1%',  top: '7%'  }, text: '"The Marketing Clarity Package — done-for-you content systems for busy founders."' },
  { key: 'a',    source: 'instagram',relevant: true,  pos: { left: '57%', top: '3%'  }, text: '"Stop posting daily and hoping. Most founders are exhausted by content that never converts."' },
  { key: 'b',    source: 'instagram',relevant: true,  pos: { left: '65%', top: '40%' }, text: '"I\'m so tired of watching good founders burn out on content nobody asked for."' },
  { key: 'yt',   source: 'youtube',  relevant: true,  pos: { left: '3%',  top: '52%' }, text: '▶ "Why your content isn\'t the problem — your offer is"' },
  { key: 'li',   source: 'linkedin', relevant: false, pos: { left: '55%', top: '73%' }, text: '"5 tools every founder needs in their stack this year."' },
  { key: 'news', source: 'newsletter',relevant: false,pos: { left: '7%',  top: '81%' }, text: '"This week: a calmer system for showing up without the grind."' },
  { key: 'c',    source: 'instagram',relevant: true,  pos: { left: '30%', top: '85%' }, text: '"The whole \'post 3x a day\' advice is why you\'re tired and broke."' },
  { key: 'cal',  source: 'calendar', relevant: false, pos: { left: '33%', top: '1%'  }, text: "Podcast guest — 'The Anti-Hustle Marketing Show'" },
];

export const seeing = {
  kicker: 'What I see',
  observation: [
    "You're sharpest when you're ",
    { em: 'frustrated' },
    '. The posts where you call out the daily-hustle advice are your most ignored — and your best — work.',
  ] as Rich,
  reframe: 'What that means: your audience trusts your conviction before your expertise.',
} as const;

export const verdict = {
  confirm: "Yes — that's right",
  deny: 'Not quite',
  correctionPrompt: "Tell me what I'm reading wrong — one line.",
  correctionPlaceholder: 'e.g. the frustration is deliberate, not my mood…',
  send: 'Send',
  sharpenedWithText:
    "That sharpens it — if it's deliberate, it isn't your mood, it's your positioning. Stronger.",
  sharpenedEmpty: "Noted — I'll hold it differently and keep watching for your real edge.",
} as const;

export const conversation = {
  intro: [
    'I understand your business now. To go further I need to understand how ',
    { em: 'you' },
    ' think about it.',
  ] as Rich,
  kicker: 'One real question',
  question: [
    'Your homepage sells ',
    { em: 'calm clarity' },
    '. Your sharpest posts sell ',
    { em: 'righteous frustration' },
    '. Which one is the real you — and which are you hiding?',
  ] as Rich,
  placeholder: "Take your time. Say it the way you'd say it to someone you trust…",
  button: 'Tell Business Brain',
  hint: 'this is the thread everything else pulls on',
  minChars: 3,
  // Placeholder sample only — NOT used for the Gift echo (the echo uses the typed answer).
  conversationFixtureAnswer:
    'Honestly the frustration is the real me — the calm version is what I thought I was supposed to sound like.',
} as const;

export const absorbingLine: Rich = [
  "Then that's the thread I'll pull on. I'll hold it as something ",
  { em: 'you told me' },
  ' — never something I assumed.',
];

export const gift = {
  intro:
    "I understand enough to try. Here's a first attempt at your voice — tell me where I'm wrong, that's how I learn it.",
  kicker: 'First draft · in your voice',
  draft: {
    label: 'Reel · drafted · nothing posted',
    hook: '"The people who tell you to post daily have never run your business."',
    body:
      'Open frustrated, straight to camera. Name the lie — that volume equals trust. Then turn: the founders who win aren\'t the loudest, they\'re the clearest about what they actually believe. End on conviction, not a tip.',
  } as GiftDraft,
  echoPrefix: 'Built from what you just told me: ',
  echoSuffix: ' — I leaned the draft toward that, not the calm homepage version.',
  echoFallback: 'Built toward your sharper voice — the frustrated register, not the calm homepage one.',
  echoMax: 120,
  reactions: [
    { id: 'gy', label: "That's me" },
    { id: 'ga', label: 'Almost' },
    { id: 'gn', label: 'Not me' },
  ],
  reactionLines: {
    gy: ["Good. That tells me more about your voice than ten questions could — I'll lean into it."] as Rich,
    ga: ["Useful. The 'almost' is exactly where your real voice lives — I'll find the gap."] as Rich,
    gn: [
      "That's the most useful thing you've done yet. Knowing what ",
      { em: "isn't" },
      ' you narrows your real voice fast.',
    ] as Rich,
  },
} as const;

export const week = {
  intro:
    "So here's your first week — already shaped around what I've learned. You decide; I'll handle the rest.",
  kicker: 'Your first week · drafted, awaiting your call',
  items: [
    { day: 'Tue', title: 'The "post daily" callout reel, in your frustrated voice.', note: 'your sharpest register — leading the week on conviction' },
    { day: 'Thu', title: 'Carousel: "Clarity beats volume" — reframing your homepage promise.', note: 'closes the gap between your page and your posts' },
    { day: 'Fri', title: 'Newsletter open, rewritten to sound like you — not the calm version.', note: "carries the week's thread into your list" },
  ] as WeekItem[],
  approve: 'Approve the week',
  hold: 'Hold one to review',
  note: ['Nothing posts without your yes. I prepared it — ', { em: 'you decide' }, '.'] as Rich,
  completeLines: [
    { kind: 'big' as const, pause: 500, rich: ["That's how we'll work. Every week I'll have already started — you'll just decide."] as Rich },
    { kind: 'med' as const, pause: 300, rich: ['This is where the relationship begins.'] as Rich },
  ],
} as const;
