import { ActIContainer } from './ActIContainer';

/**
 * Dev-only preview host for the Act I static flow (Milestone 1, fixtures only).
 * Mounted behind import.meta.env.DEV in App.tsx — it does not exist in production
 * builds and does not affect the wizard or default routing.
 */
export function ActOnePreviewPage() {
  return <ActIContainer />;
}
