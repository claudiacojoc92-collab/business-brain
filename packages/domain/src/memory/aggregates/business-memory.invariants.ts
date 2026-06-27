export const BUSINESS_MEMORY_INVARIANTS = [
  'intelligence_events is append-only. No update or delete methods exist on the repository.',
  'Each founder has exactly 9 memory_layer rows (one per MemoryLayer enum value).',
  'Stream A (IntelligenceEventsEmitted batch): all events applied atomically or all rolled back.',
  'Stream B (approval events): applied individually in real time.',
  'RECALIBRATING state: incoming IntelligenceEvents queued as PENDING, not applied until RecalibrationCompleted.',
  'confidence_delta for INCREASE events is capped at 0.20 (F002).',
  'intelligence_events queries must include emitted_at for partition pruning (F006).',
] as const;
