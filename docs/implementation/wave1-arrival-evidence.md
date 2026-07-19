# Wave 1 (Trust & Arrival) — preview evidence

Internal implementation artifact — a record of the Wave 1 founder-visible surfaces as rendered from this
repo's dev server (`apps/web`, branch `feature/axe-wave1-arrival`). Reproduce locally with
`npm run dev --prefix apps/web` and open the routes below. (No browser tooling, credentials, or
machine-specific launch config is committed.)

## `/start` — Landing
Slim shell (serif "Business Brain" mark + gold dot, "Sign in" at right). Centered composition with a
staged rise on load: gold eyebrow **YOUR AI MARKETING STRATEGIST**, serif display headline
*"First I understand your business. Then I understand you. Then we build."*, the strategist promise
paragraph ("Not a report. Not a dashboard…"), and two pill CTAs — **Create your account** (dark) and
**Sign in** (outline). Reads as a considered product, not a utility page.

## `/signup` — Create account
Elevated card (surface + soft shadow, rounded). Serif "Create your account", subcopy
"Begin the relationship. It takes a moment.", labeled **Email** and **Password** (placeholder
"at least 8 characters"), dark **Create account** pill. When the server advertises it, an "or" divider +
**Continue with Google** (gold G) appears — otherwise absent (capability-gated). Footer: "Already have an
account? Sign in."

## `/signin` — Welcome back
Same card language. Serif "Welcome back", subcopy "Sign in to continue where you left off.", Email +
Password, dark **Sign in** pill, then **Forgot password?** and **Use a magic link** (the fallback,
preserved). Capability-gated **Continue with Google**. Footer: "New here? Create an account."

## Not shown
`/welcome` is session-gated (post-auth); `/recover` and `/reset` reuse the same card language. The
authenticated flow's end-to-end behavior (signup → session → welcome) is proven by the live-DB
integration tests (`apps/api/src/__tests__/session/auth-credentials.test.ts`), since the local dev API on
:3000 is the older build.

## Design system
`apps/web/src/styles/system.css` (type scale, spacing, elevation, motion, reveal/thinking keyframes) over
the existing Editorial tokens; shared components in `apps/web/src/system/ui.tsx` (AppShell, Button, Field,
GoogleButton, Thinking, and the initial RevealBlock / ConversationBubble / ApprovalCard patterns).
