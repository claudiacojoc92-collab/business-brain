/**
 * M2.2 Upload Connector — DEV preview fixtures. The SYNCED case is REAL captured output from
 * the Phase-2 guarded live run (basecamp.com website + a real uploaded DOCX internal memo →
 * recomputeFromSources): real fragment ids, real sources, the real cross-source FUSION.
 * Inferred (Beat 2) text is shown as honest excerpts of the real engine output ("…").
 * Other states (redundant/unsupported/empty/partial/failed) are honest-state fixtures.
 */
export type Src = 'website' | 'upload' | 'both';

export interface ULine {
  label: string;
  text: string;
  kind: 'observed' | 'inferred';
  source: Src;
  fragmentIds: string[];
  doc?: string;       // upload: filename
  location?: string;  // upload: anchor label ("Internal Positioning" / "slide 7")
}

export type UState = 'uploading' | 'reading' | 'synced' | 'partial' | 'empty' | 'redundant' | 'unsupported' | 'failed';

export interface UploadCase {
  key: string;
  filename: string;
  state: UState;
  readingLines: string[];
  lead: string | null;
  beat1: ULine[];
  beat2: ULine[];
  handoff: string | null;
  message: string | null;
  timing: { firstMs: number; fullMs: number };
}

// ── SYNCED — real captured live-run output (website + upload), with the cross-source fusion ──
const SYNCED: UploadCase = {
  key: 'synced',
  filename: 'internal-strategy.docx',
  state: 'synced',
  readingLines: [
    'Uploading internal-strategy.docx…',
    'Reading your document…',
    'Found 2 sections…',
    'Reading “Internal Positioning”…',
    'Reading “Deliberate Blind Spot”…',
    'Cross-referencing with your website…',
  ],
  lead: "Here's what I can already see:",
  beat1: [
    { label: 'Internal Positioning', text: 'Publicly we present Basecamp as calm software for everyone, but internally our real wedge is teams burned by heavyweight tools who want radical simplicity, not breadth.', kind: 'observed', source: 'upload', fragmentIds: ['66b515850c'], doc: 'internal-strategy.docx', location: 'Internal Positioning' },
    { label: 'Deliberate Blind Spot', text: 'We under-invest in enterprise sales on purpose because our calm brand self-selects against large teams, which quietly caps our revenue ceiling even as it protects the product philosophy.', kind: 'observed', source: 'upload', fragmentIds: ['2e9d8af5f7'], doc: 'internal-strategy.docx', location: 'Deliberate Blind Spot' },
    { label: 'Positioning', text: 'You position yourself as Trusted by millions, Basecamp puts everything you need to get work done in one place. It’s the calm, organized way to manage projects, work with clients, and communicate company-wide.', kind: 'observed', source: 'website', fragmentIds: ['235f22f679'] },
    { label: 'Offer', text: 'Your offer looks like Start free with Basecamp — one project, 20 users, forever free. Or upgrade to Plus or Pro Unlimited for unlimited projects and premium support.', kind: 'observed', source: 'website', fragmentIds: ['6d5b3a89e0'] },
  ],
  beat2: [
    { label: 'contradiction', text: "Basecamp's public claim is “calm software for everyone,” but its internal wedge is specifically teams burned by complexity — the public positioning and the private strategy point in different directions…", kind: 'inferred', source: 'both', fragmentIds: ['986b0b6a2b', 'b791ebecee', '40dd4069d8'] },
    { label: 'blind spot', text: 'The deliberate under-investment in enterprise sales is framed internally as brand protection, but the flat-rate unlimited-user pricing model is built for exactly the large teams the brand pushes away…', kind: 'inferred', source: 'both', fragmentIds: ['7cc31c935d', '2cdc022f64', '6f8ff05652'] },
    { label: 'hidden weakness', text: "Basecamp's longevity narrative (“profitable for 27 years”, “99.99% uptime”, “built to stay, not exit”) is its most repeated public signal…", kind: 'inferred', source: 'website', fragmentIds: ['d0e5f48e6a', 'ee770bba4e', '4bbdfa97e0'] },
  ],
  handoff: "That's what your site says in public and what your doc says in private. Now tell me the part neither one can — what are you actually trying to build?",
  message: null,
  timing: { firstMs: 2800, fullMs: 116000 },
};

const base = (over: Partial<UploadCase>): UploadCase => ({
  key: '', filename: '', state: 'failed', readingLines: [], lead: null, beat1: [], beat2: [], handoff: null, message: null, timing: { firstMs: 0, fullMs: 0 }, ...over,
});

// REDUNDANT gets as much care as synced (§10): honest "I've already read this", not a silent skip.
const REDUNDANT = base({
  key: 'redundant', filename: 'about-us-copy.pdf', state: 'redundant',
  readingLines: ['Uploading about-us-copy.pdf…', 'Reading your document…', "Comparing with what I've already read…"],
  message: "This looks like your website content, which I've already read — I'll skip the duplicate and keep anything new. Nothing new here, so I haven't added it twice.",
});

const PARTIAL = base({
  key: 'partial', filename: 'deck-with-website-slides.pdf', state: 'partial',
  readingLines: ['Uploading deck-with-website-slides.pdf…', 'Reading your document…', 'Found 8 slides…', "Comparing with what I've already read…"],
  lead: "Here's what's new in it:",
  beat1: [
    { label: 'slide 5', text: 'Our 2026 wedge is design partners in regulated industries — a segment the public site never mentions.', kind: 'observed', source: 'upload', fragmentIds: ['a1b2c3d4e5'], doc: 'deck-with-website-slides.pdf', location: 'slide 5' },
  ],
  beat2: [],
  handoff: "The first few slides duplicated your homepage, so I set those aside. This part is new — want to tell me more about the regulated-industries bet?",
  message: 'Slides 1–4 duplicated your website, so I kept only what was new.',
});

const EMPTY = base({
  key: 'empty', filename: 'scan-notes.txt', state: 'empty',
  readingLines: ['Uploading scan-notes.txt…', 'Reading your document…'],
  message: "I opened it but couldn't find much to read. If it's a scanned or image-only file, I can't see the text yet — a text-based PDF, Word doc, or plain text works best.",
});

const UNSUPPORTED = base({
  key: 'unsupported', filename: 'brand.sketch', state: 'unsupported',
  readingLines: ['Uploading brand.sketch…', 'Looking at the file…'],
  message: "I can't read this type yet — a PDF, Word doc, or text file works best. (Design files, spreadsheets, and image-only scans are on the list, not ready yet.)",
});

const FAILED = base({
  key: 'failed', filename: 'corrupted.pdf', state: 'failed',
  readingLines: ['Uploading corrupted.pdf…', 'Trying to open the file…'],
  message: "I couldn't open that file — it looks corrupted or wasn't fully uploaded. Want to try it again, or send a different one?",
});

export const UPLOAD_CASES: UploadCase[] = [SYNCED, PARTIAL, REDUNDANT, EMPTY, UNSUPPORTED, FAILED];
