# Spec 07 — Error handling, loading states & final polish

## Overview
Sweep pass across the whole app to guarantee every mandatory-requirement box is actually checked, not just "mostly there." Do this last, against the full built app.

## Depends on
Specs 01–06.

## Checklist to implement
- `loading.tsx` exists for every route segment that fetches data server-side (home, gear list, gear detail, all three dashboard roots and their sub-pages)
- `error.tsx` exists at root + at `dashboard/`, `gear/` — friendly message + "Try again" (calls `reset()`) and "Go home" link
- `not-found.tsx` at root (bad routes) and `gear/[id]` (bad gear ID)
- Every mutation (register, login, gear CRUD, order status change, payment init, review, admin suspend) has a `sonner` toast on both success and failure — audit against `API_INTEGRATION.md`'s full list, don't rely on memory
- Every form's Zod schema produces a human-readable message per field, not raw Zod error codes
- Mobile pass: gear grid, all tables (convert to stacked cards under `sm`), dashboard nav (hamburger/drawer), rent-now date picker
- Dark/light mode via `next-themes` (rubric bonus item, cheap to add given shadcn is already in)

## Definition of done
- [ ] Walk every route in the spec index with devtools' network tab throttled + offline toggle; confirm no route ever shows a blank white screen or unhandled promise rejection
- [ ] Full mandatory-requirements checklist in `docs/plans/PLAN.md` §11 is checked off
- [ ] Commits: `feat: add loading and error boundaries across all routes`, `feat: dark mode support`, `fix: mobile responsive pass on tables and dashboards`, `chore: final QA pass against mandatory requirements`
