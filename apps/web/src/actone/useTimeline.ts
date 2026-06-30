import { useEffect } from 'react';

/**
 * Runs an ordered set of callbacks at absolute delays (ms from mount), once.
 * Cancels on unmount, so React StrictMode's mount/unmount/mount cycle is safe.
 * Pair with idempotent advance handlers in the container as a second guard.
 */
export function useTimeline(steps: ReadonlyArray<{ at: number; run: () => void }>): void {
  // Intentionally run once on mount: the timeline is fixed per scene instance.
  useEffect(() => {
    const ids = steps.map((s) => window.setTimeout(s.run, s.at));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []);
}
