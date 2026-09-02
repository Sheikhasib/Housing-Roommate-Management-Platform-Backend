# Spec 08 — Deployment, config & submission package

## Overview
Everything that isn't "a feature" but is still a mandatory-requirement or rubric line: image domain config, environment setup across two deployed services, the admin-credential handoff, and the video walkthrough. Easy to leave until the last hour and easy to lose points on when rushed — do it as its own pass, not as an afterthought on submission day.

## Depends on
Specs 00–07 functionally complete (deploy what you've actually built; don't deploy mid-broken state and try to fix it live).

## Config

### `next.config.ts` — remote images
Gear images are uploaded to Cloudinary (Spec 05), so the whitelist is concrete, not a guess:
```ts
images: {
  remotePatterns: [
    { hostname: "res.cloudinary.com" },
  ],
}
```
If any seed/test data still references other image hosts, add those hostnames too — but Cloudinary should be the only one gear images actually use going forward.

### Environment variables (frontend, on Vercel)
| Var | Value |
|---|---|
| `BACKEND_API_URL` | your deployed backend's base URL — server-only |
| `NEXT_PUBLIC_BACKEND_API_URL` | your deployed backend's base URL — same value as `BACKEND_API_URL`, exposed client-side for direct public-data calls (see Plan §4) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | must match the backend's values exactly, or `proxy.ts`'s `jwt.verify()` will reject every token |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | your Cloudinary cloud name |

### Environment variables (backend, wherever it's deployed)
Confirm these match Spec 00's split:
| Var | Value |
|---|---|
| `FRONTEND_URL` | your deployed frontend's URL (CORS + payment redirect target) |
| `BACKEND_PUBLIC_URL` | the backend's own public URL (SSLCommerz callback target) |
| `APP_URL` / old single var | remove once split is confirmed working, so nobody accidentally reads the stale one |

## Submission checklist
- [ ] `README.md` at the frontend repo root: live URL, backend repo link, seeded admin credentials — **`admin@gearup.com` / `Admin123!`** (mandatory requirement #5, don't forget this is graded pass/fail), setup instructions for local dev
- [ ] `API_INTEGRATION.md` present at repo root (already written — verify it didn't drift from the actual implementation)
- [ ] Commit count: `git log --oneline | wc -l` on the frontend repo ≥ 20, conventional-commit prefixes throughout
- [ ] Deployed SSLCommerz flow tested against the *deployed* URLs specifically (sandbox callback URLs are origin-sensitive — a flow that works on `localhost` can silently fail once `BACKEND_PUBLIC_URL`/`FRONTEND_URL` point somewhere else)
- [ ] Double-check `.env` / `.env.local` are in `.gitignore` on both repos — the admin email/password is meant to be public (put it in the README, as above), but `DATABASE_URL`, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, and the SSLCommerz store password are not. Only `.env.example` (placeholders) should ever be committed.

## Video walkthrough (rubric #7, 10%)
7-10 min, suggested structure so nothing gets forgotten under time pressure:
1. (1 min) Quick tour of the three roles and how the UI adapts to each
2. (2 min) Customer journey: browse → filter → gear detail → rent-now → dashboard
3. (2 min) Full payment loop: provider confirms → customer pays via SSLCommerz sandbox → success page → status updates
4. (2 min) Provider dashboard: add gear, manage an order through its full status lifecycle
5. (1 min) Admin dashboard: suspend a user, manage a category
6. (1-2 min) Point out the error/loading states deliberately (trigger a validation error on camera, show a loading skeleton) — graders are specifically checking for this, make it visible rather than hoping they notice

## Definition of done
- [ ] Deployed frontend + backend both reachable, full customer→provider→payment loop works live
- [ ] Admin credentials verified working on the deployed URL, not just locally
- [ ] Video recorded against the checklist above
- [ ] Commits: `chore: configure next/image remote patterns for production`, `docs: submission README with admin credentials and setup instructions`
