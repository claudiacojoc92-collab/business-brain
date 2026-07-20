import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
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
import { WelcomePage } from './arrival/WelcomePage';
import { UnderstandPage } from './understand/UnderstandPage';
import { MarketPage } from './market/MarketPage';
import { StrategyPage } from './strategy/StrategyPage';
import { ConnectPreviewPage } from './connect/ConnectPreviewPage';
import { UploadPreviewPage } from './upload/UploadPreviewPage';
import { GooglePreviewPage } from './google/GooglePreviewPage';
import { DeclaredPreviewPage } from './declared/DeclaredPreviewPage';
import { CalendarPreviewPage } from './calendar/CalendarPreviewPage';
import { MemoryPreviewPage } from './memory/MemoryPreviewPage';
import { RecommendationPreviewPage } from './recommendation/RecommendationPreviewPage';

/**
 * The M2 founder-facing app (dashboard / onboarding / review / history + their status guards) was
 * removed in S0-T1 (Article VI — manufactured-need machinery). Login + auth are DEFERRED (retire in
 * S0-T2 when a self-serve session lands). What remains is /login + the ADR-007 nucleus dev previews.
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* A–E Wave 1 — Trust & Arrival (new premium flow, additive; the current /login flow is untouched
              and remains the default until the coherent A–E flow is complete and cut over). */}
          <Route path="/start" element={<LandingPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/recover" element={<RecoverPage />} />
          <Route path="/reset" element={<ResetPage />} />
          <Route path="/welcome" element={<WelcomePage />} />

          {/* A–E Wave 2 — Business Understanding (guided website → synthesized "I understand your business"). */}
          <Route path="/understand" element={<UnderstandPage />} />

          {/* A–E Wave 3 — Public positioning context (known-entity, source-backed public evidence). */}
          <Route path="/market" element={<MarketPage />} />

          {/* Wave 4 — Founder Strategy (bounded priority-decision reasoning over Waves 1–3 outputs). */}
          <Route path="/strategy" element={<StrategyPage />} />

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

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
