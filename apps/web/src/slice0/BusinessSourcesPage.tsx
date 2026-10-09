import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { SourcesEditor } from './ArcSurface';

/**
 * /b/:id/sources — the founder's sources for a business, reachable at ANY time (nav "Sources"), including after the
 * Day One arc is done. Add, re-read or remove; "Update my understanding" re-reads everything, and Home then shows
 * the new understanding for review (the arc reopens at Understanding; conversation, strategy and plan are kept).
 */
export function BusinessSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return null;
  return (
    <AppShell>
      <div className="s0-strat">
        <SourcesEditor businessId={id} onUpdated={() => navigate(`/b/${id}/home`)} />
      </div>
    </AppShell>
  );
}
