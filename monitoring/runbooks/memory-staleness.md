# Runbook: Memory Staleness

**Alert:** BrainSnapshotStale
**Severity:** Warning

## Symptoms
- Brain snapshot age exceeds 5 minutes (F018 SLO)
- Pipeline context builder falling back to full DB assembly
- Increased LLM pipeline latency (full memory assembly is slower than cache)

## Immediate Actions

### 1. Check Redis connectivity

redis-cli ping

If Redis is down: this is a Redis outage, not a memory issue. The pipeline will continue using DB assembly — degraded but functional.

### 2. Check snapshot builder worker logs

kubectl logs deployment/bb-workers | grep "SnapshotBuilder\|snapshot"

If the snapshot builder is throwing errors: check the memory.memory_layers table for data integrity issues.

### 3. Check memory accumulator worker

kubectl logs deployment/bb-workers | grep "MemoryAccumulator\|Stream A\|Stream B"

If memory accumulation is failing: intelligence events are not being applied to layers, causing stale snapshots.

### 4. Force snapshot rebuild

Connect to Redis and delete the stale snapshot:
  DEL "bb:snapshot:<founder_id>"

The next pipeline run will trigger a fresh DB-assembled snapshot.

## Resolution

This alert auto-resolves when the snapshot builder successfully rebuilds the cache. If the alert does not resolve within 15 minutes: escalate to engineering.
