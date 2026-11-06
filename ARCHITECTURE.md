# Architecture

## Overview

Vue SPA → `/api` (Express, one Vercel function in `gru1`) → Supabase. The API uses the service-role key, so it scopes access by hand. Roles: `administrador`, `lider`, `banco`. The mobile app writes to the same database.

## Layout

- `src/pages`, `src/components`, `src/lib`: the SPA (views, components, shared logic).
- `src/pages/MetricasPage.vue` + `src/pages/metricas/*Tab.vue` (Resumen, Equipos, Campo as child routes of `/metricas`); widgets in `src/components/metrics/`; all metrics logic in `src/lib/metrics/` (pure, tested); shared state and URL-synced filters in `useMetricas.js`.
- `src/lib/api.js`: the only HTTP client (`apiRequest`); `src/lib/authStore.js`: session + profile.
- `server/app.js`: the API (`/portal/*` scoped reads, `/admin/*` writes, `/evidencia/*` photo links). Helpers in `server/*.js`; `server/portalAuth.js` resolves the user.
- `api/index.js`: Vercel entry. `tests/`: `node:test`. `supabase/`: schema and migrations (with README).

## Practices

- Auth: `authenticate` (`/portal`, `/admin`) verifies the JWT locally with `auth.getClaims` and loads profile + roles in one query into `req.user`; `requireAdmin` guards `/admin`. Admin = `roles` includes `administrador`. No other auth scheme exists.
- Client: all calls go through `apiRequest`; the token comes from the auth store (set by `onAuthStateChange`). Profile loads once per user; token refreshes do not reload it.
- Activations endpoints scope leaders with `resolverAlcanceLider` + `aplicarAlcanceLider` and never filter by profile `estado`.
- Lists are paginated on the server with filters in SQL. Only the detail endpoint signs photos and looks up emails.
- Order is always `created_at desc, id asc`.
- Select lists are static; no schema discovery at runtime. The schema is `supabase/migrations/20261029000000_baseline.sql` plus later migrations.
- Photos are served through HMAC evidence links; the service-role key never reaches the client.
- Pure logic lives in `src/lib` and `server/*.js`; HTTP tests run the real app against `tests/helpers/fakeSupabase.mjs`.
- Database changes need approval and go through `supabase/migrations/` (workflow in `supabase/README.md`). Never edit the schema in the SQL Editor.
- Deploy is a push to `main` (Vercel): run test, lint and build first.

## Progressive cleanup

Clean up as you go; never in a sweep. Do not reformat lines you did not change.

- **Touch a file:** add `// @ts-check` on line 1 to `.js` files in `src/lib` and `server` (editor-only, no tsc script) and fix what the editor flags in your change. Add JSDoc (`@param`, `@returns`, shared `@typedef`) to the exported functions you change. Use `@ts-expect-error <reason>`, never `@ts-ignore`. If the file is too noisy, skip it and say so in the PR.
- **Refactor a file:** move logic out of `.vue` into a pure `src/lib/<feature>/*.js`; the SFC only wires state to components. Tests import those modules, never SFC source text.
- **Rewrite most of a file:** run `npx prettier --write <file>`. Templates: one element per line, components under ~200 lines, UI that repeats (cards, columns, filters) driven by a config array instead of repeated markup.
- Reference example: `src/lib/metrics/` and `src/components/metrics/` (config in `filtros.js`, `tarjetas.js`, `ranking.js`).
