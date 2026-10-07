/**
 * Calm, factual Refresh status derived from ONE coherent snapshot.
 * No invented percentages, no urgency, no internal stage names beyond the
 * public contract. Non-color state indicator (a text label + dot shape).
 */
import type { BBRefreshSnapshot } from '../api/client';

export function refreshStatusLine(s: BBRefreshSnapshot): string {
  if (s.refreshState === 'completed') return 'Your new Business Brain version is ready.';
  if (s.refreshState === 'cancelled') return 'The refresh was cancelled. Your current version has not changed.';
  if (s.refreshState === 'failed') {
    const why =
      s.failureCategory === 'insufficient_evidence'
        ? ' There was not enough recent source information to build a version.'
        : s.failureCategory === 'connection_lost'
          ? ' The connection was removed during the refresh.'
          : '';
    return `The refresh could not be completed. Your current version has not changed.${why}`;
  }
  if (s.refreshState === 'in_progress') {
    if (s.validationState === 'passed' || s.diagnosisState === 'produced') return 'Validating the complete version.';
    if (s.diagnosisState === 'running') return 'Preparing the diagnosis.';
    if (s.importState === 'sufficient') return 'Building the evidence layer.';
    return 'Importing available source information.';
  }
  return '';
}

export function RefreshProgress({ snapshot }: { snapshot: BBRefreshSnapshot }) {
  if (snapshot.refreshState === 'none') return null;
  const line = refreshStatusLine(snapshot);
  const tone =
    snapshot.refreshState === 'failed' ? 'warn' :
    snapshot.refreshState === 'completed' ? 'ok' : 'busy';
  const color = tone === 'warn' ? 'var(--warn-ink,#92400e)' : tone === 'ok' ? 'var(--ok-ink,#065f46)' : 'var(--ink-2,#374151)';
  return (
    <div
      data-testid="refresh-progress"
      data-refresh-state={snapshot.refreshState}
      style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 14px/1.5 var(--sans,system-ui)', color }}
    >
      <span aria-hidden="true" style={{ fontSize: 12 }}>{tone === 'busy' ? '◍' : tone === 'ok' ? '✓' : '△'}</span>
      <span>{line}</span>
    </div>
  );
}
