# Spec 09 — Design system & global UI rules

## Overview
A token-and-consistency pass done first so every later spec builds on a settled
system. Satisfies the brief's "Global UI & Design Rules" section: ≤3 primary
colors + neutrals, dark-mode contrast, consistent cards/radius/spacing, and
accessible forms.

## Depends on
Nothing — foundation for specs 10–16.

## Color system (`app/globals.css`)

Current state (verified):
```css
--primary: oklch(0.508 0.118 165.612);        /* forest green */
--primary-foreground: oklch(0.979 0.021 166.113);
--accent: oklch(0.97 0.001 106.424);           /* warm olive wash — not usable as a fill */
--accent-foreground: oklch(0.216 0.006 56.043);
--chart-1..5: blue/cyan hue scale              /* chart-only, keep */
```
Green already satisfies "1 brand color". The existing `--accent` is a near-neutral
wash, so the brief's "pop of color" comes from a **new amber/copper accent**.

### Add three new tokens (both `:root` and `.dark`)
```css
--accent-solid:  oklch(0.769 0.172 70);   /* amber — CTA/sale/star fill */
--accent-solid-foreground: oklch(0.18 0.02 70);  /* near-black, ≥4.5:1 on both fills */
--accent-strong: oklch(0.7 0.15 65);      /* deeper copper — hover/emphasis */
```
- `--accent-solid-foreground`: near-black `oklch(0.18 0.02 70)` in **both**
  themes (verified 5.97:1 on `--accent-solid` and 5.33:1 on `--accent-strong`,
  both ≥ 4.5:1 AA). Do NOT lighten past ~0.2 lightness — `oklch(0.25)` fails
  at 3.91:1/3.50:1.
- Contrast rule for `--accent-strong`: keep lightness at **0.7**. It reads
  5.33:1 with the dark foreground (≥ 4.5:1). It is **not** darker than that —
  `oklch(0.59 0.16 65)` fails at ≈4.16:1. `hover:bg-accent-strong` may only
  paint where the text is bold/large or where the fill is decorative; never
  paired with body-size `--accent-solid-foreground` text.
- Add to the `@theme inline` block: `--color-accent-solid`,
  `--color-accent-solid-foreground`, `--color-accent-strong` so Tailwind classes
  `bg-accent-solid`, `text-accent-solid`, `hover:bg-accent-strong` work.
- `--primary` green untouched. Neutral scale untouched. `--chart-*` untouched.

### Dark mode contrast pass (after token change)
- Verify with browser devtools contrast checker on **both** themes:
  - `bg-accent-solid` + `text-accent-solid-foreground` ≥ 4.5:1 (verified 5.97:1)
  - `bg-accent-strong` + `text-accent-solid-foreground` ≥ 4.5:1 (verified 5.33:1)
  - existing `background/foreground`, `card/card-foreground`, `muted/muted-foreground`
    still ≥ 4.5:1 body / 3:1 large

### Token documentation
- Add a one-line comment above each new token: `/* amber accent — sale flags, CTA emphasis, star ratings */`.

## Component consistency audit
- Grep `rg "<button" --glob '!components/ui/*'` — matches fall into two buckets:
  1. **Action buttons that must become the shared `Button`** (done):
     `not-found.tsx`, `components/shared/error-fallback.tsx`,
     `components/shared/pagination.tsx`, `components/shared/navbar.tsx`
     (theme toggle / user menu — already uses `Button`),
     `(authGroup)/_components/*.tsx` (already use `Button`), pay `page.tsx`,
     `OrderHistoryTable.tsx` (Pay Now / Leave Review), `BackButton.tsx`,
     and table action buttons (suspend/activate, status transitions — already
     `Button`).
  2. **Legitimately custom interactive elements that stay raw `<button>`** but
     MUST have `cursor-pointer` + `transition-colors` + a visible
     `focus-visible:ring-2 focus-visible:ring-ring`: star rating pickers
     (`ReviewForm`), quantity steppers (`RentNowPanel`), image-gallery
     thumbnails (`GearImageGallery`), upload triggers (`gear-image-upload.tsx`),
     and segmented filter/role pills (`OrderTable`, `UsersTable`).
- Cards: **square corners** — matching the existing GearCard (`ring-1
  ring-foreground/5` border treatment) and `Card` (`card.tsx`, which is
  `overflow-hidden` + `ring-1` with **no** `rounded-*`). Do NOT introduce
  `rounded-md`; the base `--radius` stays for future use. Media inside cards
  already clips via the card's `overflow-hidden`.
- Buttons: the shared `Button` already has `transition-colors`/`transition-all`
  and focus rings, but the base class **lacks `cursor-pointer`** (browsers
  default `<button>` to `cursor: default`) — add it once to the `Button` cva
  base (done). Primary CTA hover uses `hover:bg-primary/80` today — switch
  CTA-primary hover to `hover:bg-accent-strong` only where amber semantics
  apply (demo flags, "Live" dots, ratings). Keep primary green for main nav
  actions. Never change the opacity of `--accent-solid` for hover — darken via
  `bg-accent-strong` exactly as tokenized, so the hover state stays ≥ 4.5:1.

## Hardcoded-color sweep (`text-red-500`, `text-amber-400`, `bg-amber-*`)
- `rg "text-red-500|text-amber-400|bg-amber-[0-9]"` — every hit maps to a token:
  - `text-red-500` inline validation errors (auth forms, `ReviewForm`,
    `GearForm`, `CategoryManager`) → `text-destructive`
  - `text-amber-400` star icons (`ReviewForm.tsx:78`, `ReviewItem.tsx:32`) →
    `text-accent-solid`
- Verify NO remaining `text-red-500`/`text-amber-400` after the sweep.
- Status-badge colors (`text-red-600`/`bg-red-50`, `text-amber-600`/`bg-amber-50`,
  etc.) are **out of scope** — they are centralized in `lib/badgeStyles.ts` and
  owned by spec 04's status-badge requirement.

## Form accessibility (feeds §10 of the brief)
- `components/ui/input.tsx`: ensure it forwards `id`, `aria-invalid`,
  `aria-describedby`, and `name` (verify the shadcn build already does — if it
  spreads props, no change needed).
- **LoginForm** (`app/(authGroup)/_components/LoginForm.tsx`): wrap each input
  in a `<label className="block">` linked via `htmlFor="login-email"` /
  `"login-password"`; set `id` on the inputs; keep inline error `<p>`s but give
  them `id` matching `aria-describedby`.
- **RegisterForm**: same treatment (name, email, password, confirmPassword,
  profilePhoto — the fields actually present; no role/phone inputs exist).
- Every later form (contact spec 15, profile spec 13) must follow this exact
  label/`htmlFor`/`aria-describedby` wiring.

## Rules for implementation
- Colors only via `globals.css` variables — no inline hex/arbitrary Tailwind
  color values for design-system colors, and no default-palette classes
  (`text-red-500`, `text-amber-400`) for error/accent UI.
- Cards are **square** (`ring-1 ring-foreground/5`, no `rounded-*`); do not
  introduce new radius values. Buttons keep `rounded-none` (already in `Button`).
- Default to neutral when unsure.
- No new dependencies in this spec.

## Definition of done
- [ ] `globals.css` documents each token; exactly 1 brand + 1 accent + 1
      destructive + neutral scale; `--accent-solid` usable as `bg-accent-solid`
      and `--accent-strong` usable as `hover:bg-accent-strong`
- [ ] `--accent-solid-foreground` is `oklch(0.18 0.02 70)` and measures ≥ 4.5:1
      against `--accent-solid` AND `--accent-strong` in both themes (5.97:1 /
      5.33:1 by computation — confirm in devtools, not assumed)
- [ ] Dark mode contrast ≥ AA on every token pairing incl. the new accent
- [ ] `rg "<button"` outside `components/ui/` returns only the shared `Button`
      plus the allowlisted custom controls (star pickers, quantity steppers,
      gallery thumbnails, upload triggers, segmented filter/role pills) — each
      with `cursor-pointer` + `focus-visible:ring-2`
- [ ] `rg "text-red-500|text-amber-400"` returns zero hits (status-badge colors
      stay in `lib/badgeStyles.ts`, spec 04 domain)
- [ ] GearCard + `Card` stay square (`ring-1 ring-foreground/5`, no `rounded-*`)
      — no new radius canonized
- [ ] Login/Register inputs are label-connected with `htmlFor`/`aria-describedby`
- [ ] Commits: `feat: define amber accent tokens and audit dark mode contrast`,
      `refactor: enforce shared Button and card styles across the app`,
      `feat: accessible labeled inputs on auth forms`
