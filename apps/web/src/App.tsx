import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
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
