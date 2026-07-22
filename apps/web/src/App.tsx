import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { HomePage } from './home/HomePage';
import { BusinessPage } from './business/BusinessPage';
import { SourcesPage } from './sources/SourcesPage';
import { LoginPage } from './pages/LoginPage';
import { AccountPage } from './pages/AccountPage';
import { ReadsListPage } from './pages/ReadsListPage';
import { FirstReadPage } from './pages/FirstReadPage';
import { ConnectPage } from './pages/ConnectPage';
import { DeclarePage } from './declare/DeclarePage';
import { LandingPage } from './arrival/LandingPage';
import { SignUpPage } from './arrival/SignUpPage';
import { SignInPage } from './arrival/SignInPage';
import { RecoverPage } from './arrival/RecoverPage';
import { ResetPage } from './arrival/ResetPage';
import { UnderstandPage } from './understand/UnderstandPage';
import { MarketPage } from './market/MarketPage';
import { StrategyPage } from './strategy/StrategyPage';
import { StrategyThreadPage } from './strategy/StrategyThreadPage';
import { ClarityPage } from './clarity/ClarityPage';
import { UnderstandingSurfacePage } from './understanding/UnderstandingSurfacePage';
import { PilotActivatePage } from './pilot/PilotActivatePage';
import { StrategicContextPage } from './strategic-context/StrategicContextPage';
import { ConnectPreviewPage } from './connect/ConnectPreviewPage';
import { UploadPreviewPage } from './upload/UploadPreviewPage';
import { GooglePreviewPage } from './google/GooglePreviewPage';
import { DeclaredPreviewPage } from './declared/DeclaredPreviewPage';
import { CalendarPreviewPage } from './calendar/CalendarPreviewPage';
import { MemoryPreviewPage } from './memory/MemoryPreviewPage';
import { RecommendationPreviewPage } from './recommendation/RecommendationPreviewPage';

/**
 * Root routing (Phase 1). The bare root and any unknown path resolve through RootRedirect, which sends a
 * SIGNED-IN founder to /home and a SIGNED-OUT visitor to /start (the arrival surface) — never to the obsolete
 * /login. This is the single entry decision; the app shell (PrimaryNav) then carries the founder across surfaces.
 */
function RootRedirect() {
  const { founderId, isLoading } = useAuth();
  if (isLoading) return null; // resolving the session cookie; avoid a wrong-way flash
  return <Navigate to={founderId ? '/home' : '/start'} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Bare root → founder-aware entry (signed-in → /home, signed-out → /start). */}
          <Route path="/" element={<RootRedirect />} />

          {/* Phase 1 — the unified authenticated product: Home, Business, Sources (nav also links the
              existing Understanding / Clarity / Strategy / Account surfaces below). */}
          <Route path="/home" element={<HomePage />} />
          <Route path="/business" element={<BusinessPage />} />
          <Route path="/sources" element={<SourcesPage />} />

          {/* Legacy self-serve login — kept reachable by URL but no longer a destination we route founders to. */}
          <Route path="/login" element={<LoginPage />} />

          {/* A–E Wave 1 — Trust & Arrival (signed-out entry). */}
          <Route path="/start" element={<LandingPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/recover" element={<RecoverPage />} />
          <Route path="/reset" element={<ResetPage />} />
          {/* /welcome retired as a separate destination — the founder lands in the product at /home. */}
          <Route path="/welcome" element={<Navigate to="/home" replace />} />

          {/* A–E Wave 2 — Business Understanding (guided website → synthesized "I understand your business"). */}
          <Route path="/understand" element={<UnderstandPage />} />

          {/* A–E Wave 3 — Public positioning context (known-entity, source-backed public evidence). */}
          <Route path="/market" element={<MarketPage />} />

          {/* Wave 4 — Founder Strategy (bounded priority-decision reasoning over Waves 1–3 outputs). */}
          {/* Pilot (Founder Validation Readiness) — invite activation + minimal setup. */}
          <Route path="/activate" element={<PilotActivatePage />} />

          {/* Clarity / Sensemaking — the tension→clarity entry point BEFORE a Strategy Thread. */}
          <Route path="/clarity" element={<ClarityPage />} />
          <Route path="/clarity/:concernId" element={<ClarityPage />} />
          {/* The founder-facing effective Understanding surface (accumulated + reusable). */}
          <Route path="/understanding" element={<UnderstandingSurfacePage />} />

          <Route path="/strategy" element={<StrategyPage />} />
          {/* Show Me the Loop — the rendered Strategy Thread: one filmable Recommendation→…→Learning→Promotion→next journey. */}
          <Route path="/strategy/thread/:rootSessionId" element={<StrategyThreadPage />} />

          {/* Wave 4 — Founder Strategic Context (explicit, founder-controlled strategy conditions). */}
          <Route path="/strategic-context" element={<StrategicContextPage />} />

          {/* Real product: the connect surface (S1-T5b) — the authenticated landing. Magic Link → Connect
              → Generate → Read. Session-guarded; consumes only the production connect + generate endpoints. */}
          <Route path="/connect" element={<ConnectPage />} />

          {/* Real product: the declaration surface (P1·S1) — direct founder input, the `declared` leg of the
              Value Spine. Session-guarded; persist-only (no generation on submit). */}
          <Route path="/declare" element={<DeclarePage />} />

          {/* Real product: account (export + delete). Redirects to /login when signed out. */}
          <Route path="/account" element={<AccountPage />} />

          {/* Real product: the Business Read surface (S1-T6). Session-guarded; pure read of persisted
              snapshots. The list is the "return to" target; :readId renders one immutable Read. */}
          <Route path="/reads" element={<ReadsListPage />} />
          <Route path="/reads/:readId" element={<FirstReadPage />} />

          {/* Dev-only: ADR-007 nucleus preview surfaces (not registered in prod). */}
          {import.meta.env.DEV && (
            <Route path="/connect-preview" element={<ConnectPreviewPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/upload-preview" element={<UploadPreviewPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/google-preview" element={<GooglePreviewPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/declared-preview" element={<DeclaredPreviewPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/calendar-preview" element={<CalendarPreviewPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/memory-preview" element={<MemoryPreviewPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/recommendation-preview" element={<RecommendationPreviewPage />} />
          )}

          {/* Fallback — founder-aware, never the obsolete /login. */}
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
