import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LocaleProvider } from './i18n/LocaleContext';
import type { Locale } from './i18n/messages';
import { SessionProvider, useSession } from './slice0/session';
import { ErrorBoundary } from './slice0/ErrorBoundary';
import { LandingV0 } from './slice0/LandingV0';
import { AuthPage } from './slice0/AuthPage';
import { SigninCallbackPage } from './slice0/SigninCallbackPage';
import { BusinessHomePage } from './slice0/BusinessHomePage';
import { HomePage } from './slice0/HomePage';
import { BusinessPage } from './slice0/BusinessPage';
import { CreateIndexPage } from './slice0/CreateIndexPage';
import { ConversationPage } from './slice0/ConversationPage';
import { TalkProvider } from './slice0/TalkDrawer';
import { AddContextProvider } from './slice0/AddContextDrawer';
import { StrategyPage } from './slice0/StrategyPage';
import { VoicePage } from './slice0/VoicePage';
import { PlanPage } from './slice0/PlanPage';
import { TodayPage } from './slice0/TodayPage';
import { CarouselPage } from './slice0/CarouselPage';
import { PhotoCreatePage } from './slice0/PhotoCreatePage';
import { ReelCreatePage } from './slice0/ReelCreatePage';
import { ShootPlanPage } from './slice0/ShootPlanPage';
import { PrivacyPage, TermsPage, DataDeletionPage, ContactPage } from './legal/LegalPages';
import { LandingPage } from './legal/LandingPage';
import { setInterfaceLocale } from './api/client';
import './slice0/slice0.css';

/**
 * Slice 0 production routing. The founder path is: /signin → / (businesses) → /b/:id (start).
 * The retired weekly-cycle / diagnosis / research surfaces are intentionally NOT routed here
 * (their files remain on disk and unit-tested in isolation); the production path never lands
 * on a research surface, passive-card MVP, or debug harness.
 */

function Loading() {
  return <div className="s0-loading">Loading…</div>;
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const { account, isLoading } = useSession();
  if (isLoading) return <Loading />;
  if (!account) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { account, isLoading } = useSession();
  if (isLoading) return <Loading />;
  if (account) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

/** Persist the interface locale to the founder record once signed in (best-effort). */
function syncLocale(locale: Locale): void {
  try {
    if (localStorage.getItem('bb_access_token')) void setInterfaceLocale(locale).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function App() {
  return (
    <LocaleProvider onLocaleChange={syncLocale}>
      <BrowserRouter>
        <SessionProvider>
          <TalkProvider>
          <AddContextProvider>
          <ErrorBoundary>
          <Routes>
            {/* Founder product entry — Business Brain owns `/` */}
            <Route path="/" element={<LandingV0 />} />
            <Route path="/signin" element={<RedirectIfAuthed><AuthPage /></RedirectIfAuthed>} />
            <Route path="/signin/callback" element={<SigninCallbackPage />} />

            {/* Meta reviewer/compliance surface — dedicated route, kept for App Review; not the founder entry */}
            <Route path="/verify" element={<LandingPage />} />

            {/* Public legal pages — no login required */}
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/privacy-policy" element={<PrivacyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/data-deletion" element={<DataDeletionPage />} />
            <Route path="/contact" element={<ContactPage />} />

            <Route path="/home" element={<RequireSession><BusinessHomePage /></RequireSession>} />
            <Route path="/b/:id/home" element={<RequireSession><HomePage /></RequireSession>} />
            <Route path="/b/:id" element={<RequireSession><BusinessPage /></RequireSession>} />
            <Route path="/b/:id/create" element={<RequireSession><CreateIndexPage /></RequireSession>} />
            <Route path="/b/:id/talk" element={<RequireSession><ConversationPage /></RequireSession>} />
            <Route path="/b/:id/reel/create" element={<RequireSession><ReelCreatePage /></RequireSession>} />
            <Route path="/b/:id/reel/shoot" element={<RequireSession><ShootPlanPage /></RequireSession>} />
            <Route path="/b/:id/reel/shoot/:planId" element={<RequireSession><ShootPlanPage /></RequireSession>} />
            <Route path="/b/:id/reel/:reelId" element={<RequireSession><ReelCreatePage /></RequireSession>} />
            <Route path="/b/:id/strategy" element={<RequireSession><StrategyPage /></RequireSession>} />
            <Route path="/b/:id/voice" element={<RequireSession><VoicePage /></RequireSession>} />
            <Route path="/b/:id/plan" element={<RequireSession><PlanPage /></RequireSession>} />
            <Route path="/b/:id/today" element={<RequireSession><TodayPage /></RequireSession>} />
            <Route path="/b/:id/create/:handoffId" element={<RequireSession><CarouselPage /></RequireSession>} />
            <Route path="/b/:id/photos" element={<RequireSession><PhotoCreatePage /></RequireSession>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
          </AddContextProvider>
          </TalkProvider>
        </SessionProvider>
      </BrowserRouter>
    </LocaleProvider>
  );
}
