# apps/web (@business-brain/web)

React + Vite SPA. In prod it's a static build served by nginx (`Dockerfile.web`,
`default.conf.template`), which proxies `/v1`, `/auth`, and `/api` same-origin to the api.

## Conventions

- Standalone: app code imports no `@bb/*` packages. The only exception is the Vitest-only
  `src/test/*.realapi.integration.spec.tsx`, and `tsconfig.json` keeps integration specs out of the build.
- All HTTP goes through `src/api/client.ts`: `API_BASE = '/'`, JWT in `localStorage['bb_access_token']`,
  and non-2xx responses throw `ApiError(status, code, message)`. Handle failures with the existing
  catch → `setError` pattern. Never fail silently.
- Every founder-facing string goes in `src/i18n/messages.ts` (flat keys, `{var}` interpolation), with
  entries for all three locales: `en`, `ro`, `it`. Default is `en`.
- Lint uses this app's own `.eslintrc.cjs` (`root: true`). The repo-root `npm run lint` skips `apps/web`.
  Run `npm run lint --workspace @business-brain/web`.
- Build-time env goes in `apps/web/.env` (Vite): `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_PICKER_API_KEY`.
- nginx timeouts are 300s on purpose because LLM generations run 45s to 4min. Don't lower them.

## Commands

```bash
npm run dev --workspace @business-brain/web     # :5173, proxies /v1 /auth /api /dev → localhost:3000
npm run type-check --workspace @business-brain/web
npm run test --workspace @business-brain/web    # jsdom, globals, setup in src/test/setup.ts
npm run build --workspace @business-brain/web   # tsc --noEmit && vite build (only when asked)
```

Tests live in `src/test/*.test.tsx`.
