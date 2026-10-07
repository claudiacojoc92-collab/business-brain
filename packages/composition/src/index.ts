// @bb/composition — the single canonical Business Brain runtime assembly. Constructs the complete service graph
// for the executable entrypoints (apps/api, apps/workers). It owns NO executable concern (no HTTP server, no
// worker lifecycle) and has no side effects on import.
export * from './composition-root';
