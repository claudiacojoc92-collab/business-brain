import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReadClaim, RecommendationClaim, Receipt } from './types';
import { EvidenceReceipt } from './EvidenceReceipt';
import { ReceiptDisclosure } from './ReceiptDisclosure';
import { EpistemicLabel } from './EpistemicLabel';
import { GapView } from './GapView';
import { RecommendationView } from './RecommendationView';

/**
 * S1-T6 C1 — the Read presentation atoms. Proves Article VII made visible: receipts expand IN PLACE, show
 * VERBATIM text with NO interpretation, the S3 sides stay SEPARATE, epistemic labels are distinct, no raw
 * internal enum reaches the DOM, recommendations carry no obey control, and no forbidden Language strings.
 */
const obsReceipt: Receipt = { fragmentId: 'o1', epistemicKind: 'observed', sourceType: 'website', text: 'Calm software for everyone.', sourceLabel: 'a.example', occurredAt: '2026-06-01T00:00:00.000Z', capturedAt: '2026-07-01T00:00:00.000Z' };
const decReceipt: Receipt = { fragmentId: 'd1', epistemicKind: 'declared', sourceType: 'founder', text: 'We are enterprise-first.', sourceLabel: 'Direction', capturedAt: '2026-07-01T00:00:00.000Z' };
const gapClaim: ReadClaim = { statement: 'Your declared enterprise focus and your calm-for-everyone positioning diverge.', epistemicKind: 'inferred', internalCategory: 'contradictions', provenance: { fragmentIds: [] }, declaredReceipts: [decReceipt], observedReceipts: [obsReceipt] };
const recClaim: RecommendationClaim = { statement: 'Client collaboration is an under-marketed moat.', epistemicKind: 'inferred', internalCategory: 'hiddenStrengths', provenance: { fragmentIds: [] }, receipts: [obsReceipt], disclosure: { assumptions: ['SMB buyers value simplicity'], confidence: 'medium', truthStatus: 'inferred' } };
const INTERNAL_ENUMS = ['contradictions', 'blindSpots', 'hiddenWeaknesses', 'hiddenStrengths', 'positioningOpportunities'];
const FORBIDDEN = ['Great', 'Amazing', 'Insight', 'Biggest problem', 'You should', 'Take action', 'Fix this', 'We found', "Let's"];

describe('EvidenceReceipt — pure evidence, verbatim', () => {
  it('renders the verbatim text + source metadata, and NOTHING interpretive', () => {
    render(<EvidenceReceipt receipt={obsReceipt} />);
    expect(screen.getByText(/Calm software for everyone\./)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).toContain('a.example'); // source label where stored
    // no interpretation/analysis/recommendation vocabulary inside a receipt
    for (const w of ['means', 'suggests', 'recommend', 'therefore', 'insight', 'takeaway']) {
      expect(text.toLowerCase()).not.toContain(w);
    }
  });
});

describe('ReceiptDisclosure — expand/collapse in place', () => {
  it('is collapsed by default; toggles the region and aria-expanded in place', () => {
    render(<ReceiptDisclosure label="What this rests on"><p>the evidence body</p></ReceiptDisclosure>);
    const btn = screen.getByRole('button', { name: /what this rests on/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('the evidence body')).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('the evidence body')).toBeInTheDocument(); // appears in place
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('the evidence body')).not.toBeInTheDocument(); // collapsible again
  });
});

describe('EpistemicLabel — distinct, word-based, no raw enum', () => {
  it('renders Observed / Declared / Inferred read distinctly', () => {
    const { rerender } = render(<EpistemicLabel kind="observed" />);
    expect(screen.getByText('Observed')).toBeInTheDocument();
    rerender(<EpistemicLabel kind="declared" />);
    expect(screen.getByText('Declared')).toBeInTheDocument();
    rerender(<EpistemicLabel kind="inferred" />);
    expect(screen.getByText('Inferred read')).toBeInTheDocument();
  });
});

describe('GapView — two SEPARATE receipt groups, verdict withheld, no enum/rank', () => {
  it('renders the statement + two independent disclosures; expands each side separately', () => {
    render(<GapView claim={gapClaim} />);
    expect(screen.getByText(/positioning diverge/)).toBeInTheDocument();
    const story = screen.getByRole('button', { name: /the story you/i });
    const evidence = screen.getByRole('button', { name: /the evidence/i });
    expect(story).not.toBe(evidence); // two distinct controls, never merged
    // receipts hidden until expanded
    expect(screen.queryByText(/We are enterprise-first\./)).not.toBeInTheDocument();
    fireEvent.click(story);
    expect(screen.getByText(/We are enterprise-first\./)).toBeInTheDocument(); // declared side
    expect(screen.queryByText(/Calm software for everyone\./)).not.toBeInTheDocument(); // observed still collapsed → SEPARATE
    fireEvent.click(evidence);
    expect(screen.getByText(/Calm software for everyone\./)).toBeInTheDocument(); // observed side
  });

  it('never renders the internal category, stakes, rank, or an action control', () => {
    render(<GapView claim={gapClaim} />);
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const e of INTERNAL_ENUMS) expect(text).not.toContain(e.toLowerCase());
    for (const w of ['stakes', 'rank', 'priority', 'severity', 'urgency', 'biggest', 'respond', 'name this a bet', 'hold open']) {
      expect(text).not.toContain(w);
    }
  });
});

describe('RecommendationView — a read, not an order', () => {
  it('frames as a read, discloses basis/assumptions/confidence, and has NO obey control', () => {
    render(<RecommendationView claim={recClaim} />);
    expect(screen.getByText(/under-marketed moat/)).toBeInTheDocument();
    expect(screen.getByText(/My read, not a fact\./)).toBeInTheDocument();
    expect(screen.getByText(/Confidence: medium/)).toBeInTheDocument();
    // no accept/apply/do-this/completion control anywhere
    expect(screen.queryByRole('button', { name: /accept|apply|do this|mark done|complete/i })).not.toBeInTheDocument();
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const w of ['accept', 'apply', 'do this', 'take action', 'mark as done']) expect(text).not.toContain(w);
    // internal category never leaks even though the claim carries it
    expect(text).not.toContain('hiddenstrengths');
  });
});

describe('Language Blueprint — forbidden strings absent across components', () => {
  it('no hype/directive/verdict vocabulary and no exclamation', () => {
    render(<><GapView claim={gapClaim} /><RecommendationView claim={recClaim} /></>);
    const text = document.body.textContent ?? '';
    for (const f of FORBIDDEN) expect(text).not.toContain(f);
    expect(text).not.toContain('!');
  });
});
