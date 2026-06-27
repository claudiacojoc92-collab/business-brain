# Runbook: LLM Pipeline Failure

**Alert:** LLMPipelineFallbackRateHigh / LLMPipelineDeadLettered
**Severity:** Warning / Critical

## Symptoms
- Fallback brief rate exceeds 20% of cycles
- LLM_PIPELINE jobs appearing in dead letter queue
- Founders receiving fallback content instead of intelligence-driven briefs

## Immediate Actions

### 1. Check Anthropic API status

curl https://status.anthropic.com/api/v2/status.json

If Anthropic is degraded: wait for recovery. Fallback briefs are the correct behaviour during outages — no intervention needed unless stuck in dead letter.

### 2. Check dead letter queue

Connect to Redis and run:
  LLEN bb-dead-letter
  LRANGE bb-dead-letter 0 10

If dead letter queue is growing: check the job payload for the error message.

### 3. Check prompt registry checksums

bash deployment/scripts/validate-prompts.sh

A PROMPT_CHECKSUM_MISMATCH error will fail every pipeline stage using that prompt. If checksums fail: redeploy with the correct prompt files and rerun validate-prompts.sh.

### 4. Check LLM router logs

kubectl logs deployment/bb-workers -c bb-workers | grep "PR-008\|STRONG\|critic"

S10 (Critic) always uses STRONG model. If the STRONG model is returning errors, all pipelines will fail at the critic stage.

### 5. Manual requeue

If jobs are stuck in dead letter:
- Fix the root cause first
- Manually requeue via BullMQ dashboard or CLI
- Monitor until fallback rate drops below 5% before declaring resolved

## Escalation

If fallback rate remains above 20% after 30 minutes: escalate to engineering. Dead-lettered LLM_PIPELINE jobs always require engineering review.
