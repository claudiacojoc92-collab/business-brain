import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReviewPage } from './pages/ReviewPage';
import { HistoryPage } from './pages/HistoryPage';

/**
 * Route guard: redirect based on founder status.
 *
 * - Not authenticated       → /login
 * - INTAKE_PENDING          → /onboarding
 * - ACTIVE / anything else  → /dashboard
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { founder, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!founder) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { founder, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!founder) return <Navigate to="/login" replace />;
  if (founder.status !== 'INTAKE_PENDING') return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

function ActiveGuard({ children }: { children: React.ReactNode }) {
  const { founder, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!founder) return <Navigate to="/login" replace />;
  if (founder.status === 'INTAKE_PENDING') return <Navigate to="/onboarding" replace />;

  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0f1a', color: '#6b7280' }}>
      <span style={{ fontSize: '14px', letterSpacing: '0.05em' }}>Loading…</span>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Onboarding — only for INTAKE_PENDING founders */}
          <Route
            path="/onboarding"
            element={
              <OnboardingGuard>
                <OnboardingPage />
              </OnboardingGuard>
            }
          />

          {/* Dashboard — only for ACTIVE founders */}
          <Route
            path="/dashboard"
            element={
              <ActiveGuard>
                <DashboardPage />
              </ActiveGuard>
            }
          />

          {/* Review — one screen: brief + pending content (ACTIVE founders) */}
          <Route
            path="/review"
            element={
              <ActiveGuard>
                <ReviewPage />
              </ActiveGuard>
            }
          />

          {/* History — read-only past committed cycles (ACTIVE founders) */}
          <Route
            path="/history"
            element={
              <ActiveGuard>
                <HistoryPage />
              </ActiveGuard>
            }
          />

          {/* Root: redirect based on status */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RootRedirect />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function RootRedirect() {
  const { founder } = useAuth();
  if (!founder) return <Navigate to="/login" replace />;
  if (founder.status === 'INTAKE_PENDING') return <Navigate to="/onboarding" replace />;
  return <Navigate to="/dashboard" replace />;
}
