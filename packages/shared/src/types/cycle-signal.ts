/**
 * Minimal signal record shape shared between @bb/domain and the
 * LLM pipeline worker. Avoids a circular dependency between
 * apps/workers (where RawSignal lives) and @bb/domain.
 */
export interface CycleSignalRecord {
  signalId:    string;
  signalType:  string;
  value:       string;
  collectedAt: string;
}
