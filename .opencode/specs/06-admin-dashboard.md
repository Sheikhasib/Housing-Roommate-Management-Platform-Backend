# Spec 06 — Admin dashboard

## Overview
Platform overview, user management (suspend/activate), and read-only moderation views over all gear and orders.

## Depends on
Spec 01.

## Routes
- `app/dashboard/admin/page.tsx` — stat cards: total users, active gear, total rentals (derive from the list endpoints' counts/`meta`, or add cheap client-side counts if the backend doesn't return aggregates)
- `app/dashboard/admin/users/page.tsx` — user table
- `app/dashboard/admin/gear/page.tsx` — all gear, read-only, provider column
- `app/dashboard/admin/orders/page.tsx` — all orders, read-only, customer + gear + payment status columns

## Additional route
- `app/dashboard/admin/categories/page.tsx` — category CRUD. Easy to miss since it's not in the assignment's route table, but the backend has full admin-only CRUD here (`POST/PATCH/DELETE /api/categories`), and providers can't create gear without a category to pick from, so this is real scope, not a nice-to-have.

## Components
- `components/dashboard/admin/UsersTable.tsx` — TanStack Query, client-side search (name/email) + pagination, Suspend/Activate button per row → mutation on `/api/admin/users/:id/status`, optimistic like Spec 05's order table. Guard: the backend itself refuses to suspend an `ADMIN` account — hide the action entirely for admin rows rather than letting it fail.
- `components/dashboard/admin/GearModerationTable.tsx`, `OrderModerationTable.tsx` — read-only, reuse the badge styles from Spec 04.
- `components/dashboard/admin/CategoryManager.tsx` — simple list + inline add/edit form (RHF + Zod, name required) + delete with a confirm dialog. Delete should warn if gear items still reference the category (backend may or may not guard this — check before assuming a foreign-key error is handled gracefully; if not, disable delete for categories currently in use).

## Rules for implementation
- Same badge system, same table/skeleton patterns as Spec 04/05 — don't reinvent per-role.
- Suspend/Activate needs a confirm step (destructive-ish action) — a simple `AlertDialog`, not a raw click-to-mutate.

## Definition of done
- [ ] Admin can search/paginate users and toggle status, table updates instantly
- [ ] Gear/order moderation views render full platform data
- [ ] Admin can create/edit/delete categories, and the provider gear form (Spec 05) picks them up immediately
- [ ] Commits: `feat: admin overview stats`, `feat: admin user management table`, `feat: admin gear and order moderation views`, `feat: admin category management`
