# Spec 14 — Analytics & charts

## Overview
The brief wants charts reflecting "real, dynamic data" — not decorative
placeholders. Nothing exists today. Adds real aggregate backend endpoints plus
frontend chart components, an Admin Analytics page, and scoped charts on
Provider and Customer overviews.

## Depends on
Spec 09 (charts use the design-system colors), Spec 13 (Admin sidebar gains
Analytics entry).

## Backend (repo `GearUp-API-Backend`)

### New `src/modules/analytics/` module (route/controller/service/interface)
Follow the existing module pattern (`category` is the template). Register in
`src/app.ts` (or wherever `adminRoutes`/`providerRoutes` mount) under the
existing prefixes so auth guards apply.

#### Admin endpoints (`src/modules/analytics/analytics.route.ts`, `auth(Role.ADMIN)`)
All are **real aggregate queries** (Prisma `groupBy`, or raw SQL for time
bucketing). Never fetch full tables to reduce client-side.

1. `GET /api/admin/analytics/overview`
   - `count user`, `count gearItem where isAvailable=true` (active gear KPI),
     `count gearItem` (total), `count rentalOrder`,
     `sum(payment.amount where status=PAID)`
   - Response data:
     ```json
     { "totalUsers": 12, "totalGear": 45, "activeGear": 38, "totalRentals": 89, "totalRevenue": 12450.5 }
     ```
   - Note: the KPI cards need `activeGear` (available gear count) in addition to
     `totalGear` — do NOT try to derive it client-side.

2. `GET /api/admin/analytics/orders-by-status`
   - `rentalOrder.groupBy({ by: ['status'], _count: true })`
   - Response data:
     ```json
     [{ "status": "PLACED", "count": 10 }, { "status": "PAID", "count": 30 }]
     ```

3. `GET /api/admin/analytics/revenue-over-time?days=30`
   - Sum `payment.amount` where `status=PAID`, bucketed per day from
     `payment.paidAt` for the last N days (raw SQL `date_trunc('day', paidAt)`
     or Prisma `groupBy` if expressible). Fill missing days with 0 so the line
     chart is continuous.
   - Implementation note: `date_trunc` is PostgreSQL-specific and not
     expressible via Prisma `groupBy` — use `$queryRawUnsafe` with bound
     parameters (never interpolate `days`), and only in the PostgreSQL deploys
     (Vercel/Neon target is Postgres). If the local DB is SQLite, either
     switch to Postgres or bucket in TS from `groupBy` results.
   - Response data:
     ```json
     [{ "date": "2026-07-01", "revenue": 120 }, { "date": "2026-07-02", "revenue": 0 }]
     ```

4. `GET /api/admin/analytics/gear-by-category`
   - `gearItem.groupBy({ by: ['categoryId'], _count: true })` + join category
     names.
   - Response data:
     ```json
     [{ "category": "Cycling", "count": 12 }, { "category": "Camping", "count": 8 }]
     ```

5. `GET /api/admin/analytics/users-by-role`
   - `user.groupBy({ by: ['role'], _count: true })`
   - Response data:
     ```json
     [{ "role": "CUSTOMER", "count": 60 }, { "role": "PROVIDER", "count": 15 }, { "role": "ADMIN", "count": 1 }]
     ```

#### Provider endpoints (`auth(Role.PROVIDER)`) — same shapes, scoped
Reuse the same service functions with a `providerId` filter:
- `GET /api/provider/analytics/overview` — gear count where `providerId`,
  rentals where `gearItem.providerId`, revenue from those rentals' payments.
- `GET /api/provider/analytics/orders-by-status` — rentals scoped to the
  provider's gear.
- `GET /api/provider/analytics/revenue-over-time?days=30` — scoped.

#### Customer endpoints
**Not added.** Customer overview charts derive from the existing
`GET /api/rentals` + `GET /api/payments/customer` (small, authenticated lists —
acceptable to reduce client-side at this scale). Do not add backend surface for
customer analytics.

## Frontend (repo `GearUp-Frontend`)

### New dependency
`recharts` (latest, **must be ≥2.15 or v3** for React 19 compat — verify at
install). Charts render in both light/dark — do **not** rely on recharts'
default palette; map colors from the theme tokens (Spec 09) via a small color
helper. Chart components are `"use client"` (recharts needs the client
runtime).

### New `components/charts/`
All are **pure presentational** — props only, no fetching inside.

- `ChartCard.tsx`
  ```tsx
  interface ChartCardProps {
    title: string
    description?: string
    loading?: boolean
    empty?: boolean
    children: ReactNode
  }
  ```
  Renders a `Card`; when `loading` shows a `Skeleton` sized to the chart aspect
  ratio; when `empty` shows a muted "Not enough data yet." message; else
  `children`.

- `RevenueLineChart.tsx`
  ```tsx
  interface RevenueLineChartProps { data: { date: string; revenue: number }[] }
  ```
  `ResponsiveContainer` + `AreaChart`/`LineChart`, `XAxis dataKey="date"`,
  `YAxis`, gradient fill using `--color-primary`.

- `StatusDonutChart.tsx`
  ```tsx
  interface StatusDonutChartProps { data: { status: string; count: number }[] }
  ```
  `PieChart` inner/outer radius donut, `Cell` per status, colors from a NEW
  `STATUS_CHART_COLORS` map. **Do NOT reuse `badgeStyles.ts` for chart colors** —
  it returns Tailwind class strings, not values; recharts `Cell` needs actual
  color values. Add to `lib/badgeStyles.ts` (or a sibling `lib/chartColors.ts`):
  a `Record<string, { light: string; dark: string }>` mapping each status
  (PLACED/amber, CONFIRMED/blue, PAID/purple, PICKED_UP/green, RETURNED/gray,
  CANCELLED/red) to hex/oklch values that visually agree with the badge hues.
  Resolve via the theme (dark = `.dark` class) so charts match badges in both
  modes. This is ground work — sort it before the chart components.

- `CategoryBarChart.tsx`
  ```tsx
  interface CategoryBarChartProps { data: { category: string; count: number }[] }
  ```
  `BarChart` vertical bars, `--color-chart-1..5` cycling.

- `UsersByRoleChart.tsx`
  ```tsx
  interface UsersByRoleChartProps { data: { role: string; count: number }[] }
  ```
  `BarChart` horizontal or donut.

### API layer + hooks
- `lib/api/analytics.ts`:
  ```ts
  fetchAdminAnalyticsOverview(): Promise<IAnalyticsOverview>
  fetchAdminOrdersByStatus(): Promise<IOrdersByStatus[]>
  fetchAdminRevenueOverTime(days?: number): Promise<IRevenuePoint[]>
  fetchAdminGearByCategory(): Promise<IGearByCategory[]>
  fetchAdminUsersByRole(): Promise<IUsersByRole[]>
  fetchProviderAnalyticsOverview(): Promise<IAnalyticsOverview>
  fetchProviderOrdersByStatus(): Promise<IOrdersByStatus[]>
  fetchProviderRevenueOverTime(days?: number): Promise<IRevenuePoint[]>
  ```
  All via `apiClient` from `lib/api/client.ts`.
- New types in `lib/types.ts`:
  ```ts
  export interface IAnalyticsOverview { totalUsers: number; totalGear: number; activeGear: number; totalRentals: number; totalRevenue: number }
  export interface IOrdersByStatus { status: string; count: number }
  export interface IRevenuePoint { date: string; revenue: number }
  export interface IGearByCategory { category: string; count: number }
  export interface IUsersByRole { role: string; count: number }
  ```
- `app/(dashboardGroup)/_hooks/useAnalytics.ts` — one `useQuery` per fetch fn
  with queryKeys `["admin-analytics-overview"]`, etc.

### Routes
- `app/(dashboardGroup)/admin-dashboard/analytics/page.tsx` (new) — KPI cards
  (revenue, orders, avg order value `= totalRevenue / totalRentals`, active
  gear from `activeGear`) reusing the `AdminOverviewClient` stat-card style +
  `ChartCard`-wrapped: revenue line, status donut, gear-by-category bar,
  users-by-role bar. Add `loading.tsx`/`error.tsx` for this route.
  Five separate hooks = five skeleton states; prefer one
  `useAnalyticsOverview` query that `Promise.all`s the five fetches so the
  page has a single loading/error boundary that matches `loading.tsx`.
- `app/(dashboardGroup)/provider-dashboard/page.tsx` — add scoped revenue line
  + status donut alongside the existing stat cards
  (`ProviderOverviewClient`).
- `app/(dashboardGroup)/customer-dashboard/page.tsx` — add a small status donut
  (orders by status from `useCustomerOrders`) + spend line (from
  `useCustomerPayments`), derived client-side.

### Sidebar
- Add `Analytics` (`/admin-dashboard/analytics`) to `ADMIN_SIDEBAR_ITEMS`
  (Spec 13).

## Rules for implementation
- All chart data from real aggregate queries (or authenticated small lists for
  customer only) — no mock series.
- Loading (skeleton) + empty states on every chart — no broken empty axis.
- Charts responsive at mobile widths — test at a real mobile viewport, not a
  resize.
- Dark mode: wire chart colors through the CSS variable tokens.

## Definition of done
- [ ] All chart data comes from the new aggregate endpoints (customer from
      authenticated lists)
- [ ] `STATUS_CHART_COLORS` map exists (light + dark values per status) and the
      donut colors agree with the badge colors
- [ ] Admin Analytics page renders KPIs (incl. active gear) + 4 charts from real data
- [ ] Provider overview shows scoped charts; customer overview shows its donut/line
- [ ] Loading and empty states handled on every chart
- [ ] Charts render correctly in light and dark mode and at mobile widths
- [ ] Commits (backend): `feat: admin and provider analytics endpoints`.
      (frontend): `feat: recharts chart components`,
      `feat: admin analytics page`, `feat: provider and customer overview charts`
