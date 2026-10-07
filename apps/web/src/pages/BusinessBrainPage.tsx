import { BusinessBrainWorkspace } from '../businessbrain/BusinessBrainWorkspace';

/** Route wrapper for the Business Brain V1 workspace. */
export function BusinessBrainPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--paper,#faf9f7)' }}>
      <BusinessBrainWorkspace />
    </main>
  );
}
