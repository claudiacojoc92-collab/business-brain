import { describe, it, expect, vi } from 'vitest';
import { executePipeline } from '../../llm-pipeline/pipeline.worker';
import { createInitialContext } from '../../llm-pipeline/pipeline-context';
import { Pseudonymiser } from '../../llm-pipeline/context-builder/pseudonymiser';
import type { LLMRouter } from '@bb/infrastructure';

function makeMockLLMRouter(): LLMRouter {
  const mockResponse = JSON.stringify({
    // Generic response shape — stages validate their own schemas
    interpreted_signals:       [],
    audience_temperature:      'WARM',
    situation_summary:         'Test situation.',
    situation_delta_magnitude: 'STABLE',
    completeness_score:        0.7,
    relationship_status:       'WARM',
    key_observations:          ['obs1'],
    relevant_patterns:         [],
    memory_gaps:               [],
    forward_question_addressed:false,
    interrogation_summary:     'Summary.',
    hypotheses: [
      {
        mode:                    'AUTHORITY',
        belief_target:           'Test belief.',
        rationale:               'Test rationale.',
        confidence_contribution: 0.7,
      },
    ],
    scored_hypotheses: [
      {
        hypothesis_id:'h-mock',
        mode:         'AUTHORITY',
        score:        0.8,
        citation_tag: 'AUTH-001',
        reasoning:    'Strong authority play.',
      },
    ],
    recommended_hypothesis_id:'h-mock',
    voice_boundaries:         [],
    offer_constraints:        [],
    timing_constraints:       [],
    outcome:       'CONFIRMED',
    second_argument:'The proposed content builds authority through consistent positioning. The conviction angle is clearly articulated and differentiated. The audience temperature and signal strength support this approach. The strategic purpose aligns well with the current belief gap.',
    reasoning:     'Solid brief.',
    mode:                  'AUTHORITY',
    mode_reason:           'High authority signal.',
    belief_target_primary: 'Test belief.',
    belief_gap_addressed:  'ABSENT',
    audience_segment:      'Service professionals.',
    relationship_move_type:'CHALLENGE',
    relationship_move_desc:'Challenge conventional wisdom.',
    conviction_angle:      'Authority builds through specificity.',
    strategic_purpose:     'Establish authority.',
    piece_objectives:      [{ role: 'REEL', objective: 'Authority anchor.' }],
    forward_question:      null,
    intelligence_events:   [],
  });

  return {
    call: vi.fn().mockResolvedValue({
      content:      mockResponse,
      inputTokens:  100,
      outputTokens: 200,
      model:        'claude-sonnet-4-6',
      promptId:     'PR-001',
    }),
  } as unknown as LLMRouter;
}

describe('executePipeline', () => {
  it('calls pseudonymiser.destroy() in finally block on success', async () => {
    const ctx          = createInitialContext({
      cycleId:'c-01', founderId:'f-01', cycleNumber:1,
      correlationId:'corr', traceId:'trace',
    });
    const llmRouter    = makeMockLLMRouter();
    const pseudonymiser = new Pseudonymiser();
    const destroySpy   = vi.spyOn(pseudonymiser, 'destroy');

    await executePipeline(ctx, llmRouter, pseudonymiser);

    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it('calls pseudonymiser.destroy() even when pipeline throws', async () => {
    const ctx          = createInitialContext({
      cycleId:'c-01', founderId:'f-01', cycleNumber:1,
      correlationId:'corr', traceId:'trace',
    });
    const errorRouter  = {
      call: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    } as unknown as LLMRouter;
    const pseudonymiser = new Pseudonymiser();
    const destroySpy   = vi.spyOn(pseudonymiser, 'destroy');

    const result = await executePipeline(ctx, errorRouter, pseudonymiser);

    expect(result.success).toBe(false);
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it('returns success:false with reason when no brief committed', async () => {
    const ctx = createInitialContext({
      cycleId:'c-01', founderId:'f-01', cycleNumber:1,
      correlationId:'corr', traceId:'trace',
    });
    // Router returns invalid JSON — all stages fail
    const badRouter = {
      call: vi.fn().mockResolvedValue({
        content: 'not json', inputTokens:0, outputTokens:0,
        model:'claude-sonnet-4-6', promptId:'PR-001',
      }),
    } as unknown as LLMRouter;
    const pseudonymiser = new Pseudonymiser();

    const result = await executePipeline(ctx, badRouter, pseudonymiser);

    expect(result.success).toBe(false);
  });
});
