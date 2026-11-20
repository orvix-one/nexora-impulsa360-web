# AGENTS.md

## Project shape

- Vue 3.5 + Vite 6 SPA in JS (no TS) with vue-router. UI and copy in Spanish (Bolivia, `America/La_Paz`). Views in `src/pages` and `src/components`, shared logic in `src/lib`.
- HTTP: client calls only via `src/lib/api.js` (`apiRequest`); server auth only via `authenticate`/`requireAdmin` (Bearer + `getClaims`).
- API: Express 5 in `server/app.js`, deployed as one Vercel function (`api/index.js`, `/api/*` rewrite, region `gru1`, next to Supabase). Locally: `npm run dev:api` + `npm run dev`.
- Supabase backend. The API uses the service-role key, so RLS does not apply: scope access by hand. Portal roles: `administrador`, `lider`, `banco`; admin = `req.user.isAdmin` (`roles` includes `administrador`).
- The mobile app (`../impulsa360-mobile`) writes to the same database.
- `public/geo/*.geojson`: municipio and departamento polygons for the Metrics map, extracted from the `municipios.geom` migration (provenance in each file's `fuente`). Regenerate only if that geometry changes.

## Commands

- `npm test` (`node:test`, `tests/*.test.mjs`; one file: `node --test tests/<file>`), `npm run lint`, `npm run build`.
- `npm run format:check` and lint are a baseline, not gates. Do not reformat files you are not changing.
- CI is Vercel auto-deploying on push to `main`: run test, lint and build before pushing.
- Manual runs of the nightly crons: `node scripts/respaldar-db.mjs` (DB backup to R2), `node scripts/archivar-fotos.mjs [--dry-run]` (photos Supabase → R2). DEV restore: see `supabase/README.md`.

## Docs to trust

- `ARCHITECTURE.md` (layout, practices).
- `supabase/README.md` (migration workflow) and `supabase/migrations/` (baseline of prod, 2026-10-29, plus later migrations).
- `supabase/MODELO.md` (domain glossary and rules) and `supabase/EXPAND_CONTRACT.md` (deprecated objects kept for installed app builds). When touching code that reads or writes the DB, check the latter: propose the contract if a row's condition is met, add a row if your change leaves something unused.

## Conventions

- Comments:
  - Default to zero.
  - Write one only to explain a non-obvious constraint, decision, invariant or workaround, in one concise sentence.
  - Never narrate what the code does, restate identifiers or summarize changes.
  - Prefer clear names and small functions.
  - Non-obvious files may start with a short, stable abstract.
- Touching a file? Follow "Progressive cleanup" in `ARCHITECTURE.md` (`// @ts-check` + JSDoc, logic out of `.vue`, format only what you rewrite).
- Flag every workaround you add or find, especially fundamental or high-debt ones: what it is, why it exists and the proper fix.
- Be concise in replies, docs, commit messages and PR text: lead with the result, skip narration.

## Maintaining this file

- Suggest updating `AGENTS.md` whenever commands, structure, endpoints, invariants or conventions change. Keep it short and remove stale entries.
