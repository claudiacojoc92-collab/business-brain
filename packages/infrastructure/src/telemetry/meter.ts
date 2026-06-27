import { metrics, type Meter } from '@opentelemetry/api';

const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'bb-service';

/**
 * Returns the OpenTelemetry meter for this service.
 * All metric names follow the bb_{subsystem}_{measurement}_{unit} convention.
 * Source: Implementation Spec V1 Section 07.
 */
export function getMeter(): Meter {
  return metrics.getMeter(SERVICE_NAME);
}

/**
 * All metric instruments registered at startup.
 * Source: Implementation Spec V1 Section 07.
 */
export function registerMetrics(): void {
  const meter = getMeter();

  // Counters
  meter.createCounter('bb_api_requests_total',          { description: 'Total API requests' });
  meter.createCounter('bb_llm_calls_total',             { description: 'Total LLM API calls' });
  meter.createCounter('bb_llm_tokens_total',            { description: 'Total LLM tokens (in+out)' });
  meter.createCounter('bb_events_published_total',      { description: 'Total events published via outbox relay' });
  meter.createCounter('bb_events_dead_lettered_total',  { description: 'Total jobs moved to dead letter queue' });

  // Histograms
  meter.createHistogram('bb_api_request_duration_ms',   { description: 'API request latency in ms' });
  meter.createHistogram('bb_llm_call_duration_ms',      { description: 'LLM call latency in ms' });
  meter.createHistogram('bb_db_query_duration_ms',      { description: 'DB query latency in ms' });
  meter.createHistogram('bb_worker_job_duration_ms',    { description: 'Worker job processing latency in ms' });
  meter.createHistogram('bb_cycle_total_duration_ms',   { description: 'Full LLM pipeline duration in ms' });

  // Gauges (observable)
  meter.createObservableGauge('bb_queue_depth',              { description: 'Current queue depth per queue' });
  meter.createObservableGauge('bb_cycle_completion_rate',    { description: 'Rolling 1-hour cycle completion rate' });
  meter.createObservableGauge('bb_fallback_brief_rate',      { description: 'Rolling 1-hour fallback brief rate' });
}
