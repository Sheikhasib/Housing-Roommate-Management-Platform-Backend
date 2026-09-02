# Spec 05 — Provider dashboard

## Overview
Gear inventory CRUD and the order-management table with status-transition actions. This is the spec that most directly exercises rubric item #2's "optimistic UI updates ... without a full page reload" line.

## Depends on
Spec 00 (transition-check fix — required for this to fully work), Spec 01.

## Routes
- `app/dashboard/provider/page.tsx` — overview: total gear, active rentals, pending orders (small stat cards, server-fetched)
- `app/dashboard/provider/gear/new/page.tsx` — create form
- `app/dashboard/provider/gear/[id]/edit/page.tsx` — edit form, pre-filled
- `app/dashboard/provider/orders/page.tsx` — order table

## Components
- `components/dashboard/provider/GearForm.tsx` — shared by new/edit, RHF + Zod (`name, description, category, pricePerDay, images: string[], stock, available`). Images use a `<CloudinaryUploader />` (below), not raw URL text inputs — you have `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` configured, so use it: real drag-and-drop/file-picker upload gives a noticeably better provider UX than pasting URLs, and it's what the assignment's "image upload UI" line actually implies.
- `components/dashboard/provider/CloudinaryUploader.tsx` — client component, unsigned upload preset (create one in the Cloudinary dashboard scoped to an `unsigned` upload preset — no API secret needed client-side), `fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: formData })` with `upload_preset` + the file; on success, push the returned `secure_url` into the form's `images` field array. Show a small preview grid with per-image remove buttons while uploading/after upload.
- `components/dashboard/provider/InventoryTable.tsx` — TanStack Query list + delete mutation (confirm dialog before delete)
- `components/dashboard/provider/OrderTable.tsx` — TanStack Query list; each row's action button depends on current status (`PLACED`→Confirm, `PAID`→Mark Picked Up, `PICKED_UP`→Mark Returned); mutation uses `onMutate` to optimistically update the row's badge before the server responds, rolls back `onError` with a toast

## Validation
`lib/validations/gear.ts` — `gearSchema`: name required, pricePerDay > 0, at least one image (validated as an already-uploaded Cloudinary URL — the array only ever contains strings the uploader produced, so `z.string().url()` per entry is enough), stock >= 0.

## Rules for implementation
- Only show the action button that matches the order's *current* status — don't render a static set of buttons and disable them, since that's harder to keep in sync with the backend's actual `ALLOWED_TRANSITIONS`.
- Delete gear should be blocked (disabled button + tooltip) if it has active (non-terminal-status) rental orders — check via the gear's orders before allowing, since the backend likely doesn't guard this itself.

## Definition of done
- [ ] Add/edit/delete gear all work, list reflects changes without manual refresh
- [ ] Order table's 3 status actions each 200 (post-Spec-00 fix) and update the row instantly
- [ ] Commits: `feat: provider gear CRUD forms`, `feat: provider inventory table`, `feat: provider order management with optimistic status updates`
