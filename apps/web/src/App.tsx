import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { AccountPage } from './pages/AccountPage';
import { ReadsListPage } from './pages/ReadsListPage';
import { FirstReadPage } from './pages/FirstReadPage';
import { ConnectPage } from './pages/ConnectPage';
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

          {/* Real product: the connect surface (S1-T5b) — the authenticated landing. Magic Link → Connect
              → Generate → Read. Session-guarded; consumes only the production connect + generate endpoints. */}
          <Route path="/connect" element={<ConnectPage />} />

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
