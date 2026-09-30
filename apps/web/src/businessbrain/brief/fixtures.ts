/**
 * Synthetic-but-realistic Living Brief fixtures — used by tests AND the dev-only preview switch.
 * Deliberately NOT real founder content. Exercises: multi-edge traceability, every measure kind,
 * two execution phases, and the degraded variants (missing / broken traceability, insufficient).
 */
import type { BBCurrentVersion, BBTraceability } from '../../api/client';

const traceability: BBTraceability = {
  evidence: [
    { ref: 'e1.1', claimIndex: 0, measureIndex: 0 },
    { ref: 'e1.2', claimIndex: 0, measureIndex: 1 },
    { ref: 'e2.1', claimIndex: 1, measureIndex: 0 },
    { ref: 'e3.1', claimIndex: 2, measureIndex: 0 },
  ],
  rootCauses: [
    { ref: 'rc1', evidenceRefs: ['e1.1', 'e1.2'] },
    { ref: 'rc2', evidenceRefs: ['e2.1'] },
    { ref: 'rc3', evidenceRefs: ['e3.1'] },
  ],
  recommendations: [
    { ref: 'rec1', rootCauseRefs: ['rc1'] },
    { ref: 'rec2', rootCauseRefs: ['rc2', 'rc1'] }, // multi-edge
    { ref: 'rec3', rootCauseRefs: ['rc3'] },
  ],
  actions: [
    { ref: 'a1.1', phaseIndex: 0, actionIndex: 0, recommendationRefs: ['rec1'] },
    { ref: 'a1.2', phaseIndex: 0, actionIndex: 1, recommendationRefs: ['rec2'] },
    { ref: 'a2.1', phaseIndex: 1, actionIndex: 0, recommendationRefs: ['rec3', 'rec1'] }, // multi-edge
  ],
};

export const fullVersion: BBCurrentVersion = {
  versionId: 'itv-preview-001',
  producedAt: '2026-07-28T09:12:00.000Z',
  importWindow: { from: '2026-04-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z', postCount: 100 },
  businessReality:
    'Your audience responds to the story of how you work, not to the offer itself — the posts that ' +
    'explain your process are the ones that hold attention, while direct calls to book slip past.',
  businessConsequences: [
    'Enquiries arrive warm but infrequent, so the calendar fills in bursts rather than steadily.',
    'The strongest work is doing the least reach, because it is framed as a result rather than a method.',
    'Without a steady middle, every quiet week feels like a verdict on the business.',
  ],
  evidence: {
    claims: [
      {
        claimStatement: 'Process-led posts hold attention far longer than offer-led posts.',
        measures: [
          { descriptor: 'Share of saves on process-led posts', kind: 'proportion', value: 74 },
          { descriptor: 'Offer-led posts that reached beyond followers', kind: 'absence' },
        ],
      },
      {
        claimStatement: 'A recognisable point of view appears in the writing.',
        measures: [{ descriptor: 'A consistent narrating voice', kind: 'presence' }],
      },
      {
        claimStatement: 'Posting is clustered, not sustained.',
        measures: [{ descriptor: 'Weeks in the window with no post', kind: 'proportion', value: 38 }],
      },
    ],
  },
  cannotYetKnow:
    'We cannot yet see what happens after someone reaches out — private replies, calls and quotes are ' +
    'outside this record, so we can read attention but not yet conversion.',
  rootCauses: [
    'The offer is framed as a finished result, which reads as a claim rather than an invitation.',
    'Publishing in bursts means the audience never settles into a rhythm with you.',
    'The clearest voice is spent on craft, leaving the offer described in generic terms.',
  ],
  recommendations: [
    'Reframe the offer around the method the audience already responds to.',
    'Hold a steady minimum cadence so quiet weeks stop reading as signal.',
    'Let the same narrating voice describe the offer, not only the craft.',
  ],
  executionPlan: [
    {
      label: 'This week',
      actions: [
        { statement: 'Rewrite the offer post to lead with the process, not the result.', sequence: 1 },
        { statement: 'Schedule two process notes so the week is not silent.', sequence: 2 },
      ],
    },
    {
      label: 'Next two weeks',
      actions: [
        { statement: 'Publish one offer-in-your-voice post and watch saves, not likes.', sequence: 1 },
      ],
    },
  ],
  traceability,
};

/** Version present but the optional traceability field is absent (state: version-no-traceability). */
export const versionNoTraceability: BBCurrentVersion = (() => {
  const { traceability: _omit, ...rest } = fullVersion;
  return { ...rest, versionId: 'itv-preview-002' };
})();

/** Traceability present but a ref does not resolve (state: traceability-unavailable — fail closed). */
export const versionBrokenTraceability: BBCurrentVersion = {
  ...fullVersion,
  versionId: 'itv-preview-003',
  traceability: {
    ...traceability,
    rootCauses: [
      { ref: 'rc1', evidenceRefs: ['e1.1', 'e9.9'] }, // e9.9 does not exist → integrity unavailable
      { ref: 'rc2', evidenceRefs: ['e2.1'] },
      { ref: 'rc3', evidenceRefs: ['e3.1'] },
    ],
  },
};

/** A Version too thin to reason from (state: insufficient). */
export const insufficientVersion: BBCurrentVersion = {
  versionId: 'itv-preview-004',
  producedAt: '2026-07-28T09:12:00.000Z',
  importWindow: { from: null, to: null, postCount: 3 },
  businessReality: 'There is not yet enough here to read your business with confidence.',
  businessConsequences: [],
  evidence: { claims: [] },
  cannotYetKnow: '',
  rootCauses: [],
  recommendations: [],
  executionPlan: [],
};

export const noCurrent = { state: 'no_current_version' as const };
