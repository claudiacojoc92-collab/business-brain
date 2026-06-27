# Runbook: Outbox Relay Lag

**Alert:** OutboxRelayLag / OutboxRelayStuck
**Severity:** Warning / Critical

## Background

The outbox relay reads from app.domain_events using SELECT FOR UPDATE SKIP LOCKED (F010) and publishes events every 30 seconds (F013). Lag indicates the relay is falling behind event production.

## Symptoms
- More than 100 unpublished events in app.domain_events (Warning)
- More than 500 unpublished events for 15 or more minutes (Critical)
- Projections and process managers not reacting to domain events

## Immediate Actions

### 1. Check outbox relay worker status

kubectl logs deployment/bb-workers | grep "OutboxRelay\|relay"

If the relay loop is throwing errors: check the error message and the relay_locked_until column for stuck locks.

### 2. Check for stuck relay locks

Run this query against the database:

  SELECT id, event_type, emitted_at, relay_locked_until
  FROM app.domain_events
  WHERE published_at IS NULL
    AND relay_locked_until > NOW()
  ORDER BY emitted_at ASC
  LIMIT 20;

If locks are stuck (relay_locked_until far in the future with no progress), the relay worker may have crashed mid-batch. Clear stuck locks:

  UPDATE app.domain_events
  SET relay_locked_until = NULL
  WHERE published_at IS NULL
    AND relay_locked_until < NOW() - INTERVAL '5 minutes';

### 3. Check relay worker concurrency

If the relay worker is processing but too slowly:
- Check Redis connectivity (relay uses Redis for the event bus publish)
- Check if the in-process event bus subscribers are throwing errors
- Check for any database replication lag if using a read replica

### 4. Verify relay tick interval

The relay runs every 30 seconds. Check SCHEDULER_TICK_INTERVAL_MS is set correctly in the worker configuration (should be 30000).

### 5. Manual flush (last resort)

If the relay is stuck and engineering approval is obtained:
- Restart the workers pod: kubectl rollout restart deployment/bb-workers
- Monitor the unpublished count drop immediately after restart

## Escalation

OutboxRelayStuck (more than 500 events for 15 minutes) always requires immediate engineering escalation. Projections will be stale and founders may not receive content delivery notifications.
