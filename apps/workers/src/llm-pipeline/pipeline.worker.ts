import type { PipelineContext } from './pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { Pseudonymiser } from './context-builder/pseudonymiser';
import { runS01SignalTyper }        from './stages/s01-signal-typer';
import { runS02Interpreter }        from './stages/s02-interpreter';
import { runS03SituationModeller }  from './stages/s03-situation-modeller';
import { runS04MemoryInterrogator } from './stages/s04-memory-interrogator';
import { runS05HypothesisGenerator }from './stages/s05-hypothesis-generator';
import { runS06Evaluator }          from './stages/s06-evaluator';
import { runS07aHardConstraints }   from './stages/s07a-hard-constraints';
import { runS07bSoftConstraints }   from './stages/s07b-soft-constraints';
import { runS08Arbitration }        from './stages/s08-arbitration';
import { runS09ConfidenceCalculator}from './stages/s09-confidence-calculator';
import { runS10Critic }             from './stages/s10-critic';
import { runS11DecisionCommit }     from './stages/s11-decision-commit';
import { runS11FallbackGenerator }  from './stages/s11f-fallback-generator';
import { runS12MemoryUpdater }      from './stages/s12-memory-updater';

export type PipelineResult =
  | { success: true;  context: PipelineContext }
  | { success: false; context: PipelineContext; reason: string };

/**
 * Executes the full 12-stage LLM pipeline.
 *
 * Stage order (F005 correction — S09 before S10):
 * S01 → S02 → S03 → S04 → S05 → S06 → S07a → S07b → S08 → S09 → S10 → S11 → S12
 *
 * On failure: S11F (fallback) runs instead of S11.
 * Pseudonymiser.destroy() is ALWAYS called in the finally block.
 *
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F005/F008.
 */
export async function executePipeline(
  initialContext: PipelineContext,
  llmRouter:      LLMRouter,
  pseudonymiser:  Pseudonymiser,
): Promise<PipelineResult> {
  let ctx = initialContext;

  try {
    // Deterministic stages
    ctx = await runS01SignalTyper(ctx);

    // LLM stages (MEDIUM tier)
    ctx = await runS02Interpreter(ctx, llmRouter);
    ctx = await runS03SituationModeller(ctx, llmRouter);
    ctx = await runS04MemoryInterrogator(ctx, llmRouter);
    ctx = await runS05HypothesisGenerator(ctx, llmRouter);
    ctx = await runS06Evaluator(ctx, llmRouter);

    // Deterministic constraint stages
    ctx = await runS07aHardConstraints(ctx);
    ctx = await runS07bSoftConstraints(ctx, llmRouter);
    ctx = await runS08Arbitration(ctx);

    // F005: S09 (Confidence) runs BEFORE S10 (Critic)
    ctx = await runS09ConfidenceCalculator(ctx);

    // S10: STRONG model always — validated by prompt registry
    ctx = await runS10Critic(ctx, llmRouter);

    // Check if pipeline should fall back
    const shouldFallback = (
      ctx.errors.length > 0 ||
      ctx.confidenceAssessment?.thresholdAction === 'FALLBACK' ||
      ctx.critiqueOutcome === 'REJECTED'
    );

    if (shouldFallback) {
      ctx = await runS11FallbackGenerator(ctx, llmRouter, pseudonymiser);
    } else {
      ctx = await runS11DecisionCommit(ctx, llmRouter, pseudonymiser);
    }

    ctx = await runS12MemoryUpdater(ctx, llmRouter);

    if (!ctx.committedBrief) {
      return {
        success: false,
        context: ctx,
        reason:  'Pipeline completed but no brief was committed.',
      };
    }

    return { success: true, context: ctx };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      context: { ...ctx, errors: [...ctx.errors, `PIPELINE_EXCEPTION: ${reason}`] },
      reason,
    };
  } finally {
    // F008: always destroy pseudonymiser — success or failure
    pseudonymiser.destroy();
  }
}
