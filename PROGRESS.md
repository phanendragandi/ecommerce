# PROGRESS.md — QuickCart Build

Status legend: ✅ done · 🔄 in progress · ⏸ blocked on user · ⬜ pending

## Phase 0 — Cleanup & scaffold ✅ (Gate G0 PASSED — 2026-07-10)

- ✅ Git repo initialized; `.gitignore` fixed — the `.env*` rule was **commented out** and `.env` held old scaffold secrets (Clerk/Mongo/Cloudinary). Env files are now excluded; those old keys should still be **rotated/revoked** since they were live in a non-ignored file.
- ✅ Deleted `lib/authSeller.js`; purged Clerk/Mongo/Inngest/Cloudinary keys from `.env` (kept `NEXT_PUBLIC_CURRENCY`); removed Cloudinary image domain (added `*.supabase.co` storage pattern); renamed package `ecommerce-inngest` → `quickcart`.
- ✅ Scaffolded `/server`: Express 5 + TS `strict`, zod, helmet, CORS allowlist, rate limiters (general + strict for payments), 1mb body limit, no `x-powered-by`, zod-aware error handler, lazy `supabaseAdmin` (service role), `/health`, vitest+supertest (4 tests green).
- ✅ Created `/supabase/migrations/` (empty, awaiting Phase 1).
- ✅ Frontend plumbing: `lib/supabase/client.js` + `server.js` (`@supabase/ssr`, anon key only), `lib/api.js` (JWT-attaching fetch wrapper). `.env.example` files for both apps (names only).
- ✅ **Gate G0:** root `next build` clean (13 routes); `server tsc` clean; server tests 4/4.

Commits: `19d129f` baseline · `c224ee1` scaffold cleanup · `3909c99` server scaffold · `4dab756` frontend plumbing.

## Phase 1 — Data layer (`supabase-architect`) 🔄 (authored + audited; awaiting db push)

- ✅ Migrations authored: schema (7 tables + `order_status` enum + indexes + partial-unique Razorpay ids), `handle_new_user` signup trigger, atomic `decrement_stock` RPC (raises P0001, service-role-only), full RLS set (client-read-only orders/order_items/order_events, role-escalation guard, recursion-safe SECURITY DEFINER helpers), `product-images` bucket + policies.
- ✅ Seed: `supabase/seed.sql` (10 products from assets.js, demo seller, local-only guard). Run via `npx supabase db reset`.
- ✅ **Security audit (static): PASS** — no Critical/High. Findings fixed in place (migrations unapplied, so in-place edits are safe): storage write policies now owner-per-path (`<seller_id>/<filename>` — **Phase 2 upload endpoint must follow this path contract**); role guard made NULL-safe; seed refuses non-local DBs + random demo password.
- ℹ️ Deferred to owning phases: reject `*` in CORS allowlist (Phase 2), remove Clerk CDN URL from `assets/assets.js` (Phase 3A).
- ⏸ **Gate G1 blocked on user:** needs Supabase project + `npx supabase link`, then `npx supabase db push` + live RLS spot-check (verification SQL prepared).

## Phase 2 — Core API (`backend-engineer`) ✅ (Gate G2 PASSED — 2026-07-10)

- ✅ `requireAuth` (Supabase JWT via `auth.getUser`) + `requireSeller` (role from DB, never client-supplied).
- ✅ Routes: public `GET /api/products[/:id]` (active only), `GET /api/me`, addresses CRUD, cart sync `GET/PUT /api/cart`, seller product CRUD (soft delete) + `POST /:id/images` (multer, 4×5MB, jpeg/png/webp, storage keys `<seller_id>/<uuid>.<ext>` per RLS path contract).
- ✅ zod validation on every body/query/param; strict rate limit on all mutations; CORS now rejects `*`.
- ✅ **Gate G2:** tsc strict clean; 34/34 vitest+supertest green (happy + 401/403 + zod 400 per route). Orchestrator reviewed auth/ownership/upload paths against CLAUDE.md — clean.
- Note: response envelope is `{ success, data }` (matches scaffold convention).

## Phase 3A — Frontend wiring ✅ (Gate G3A static PASSED — 2026-07-10)

- ✅ Login/signup (email/password + Google OAuth) + `/auth/callback` (open-redirect-safe `next`), session middleware.
- ✅ AppContext: real session/profile, `isSeller` from DB role, live products, debounced cart sync + guest merge, `clearCart`/`flushCart`.
- ✅ Seller gating (layout, no flash) + every page on live data with loading/error/empty states; zero `dummyData` outside assets.
- ⚠️ Root build requires `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` at build time (set in Vercel; devops Phase 6 note).

## Phase 3B — Payments & tracking ✅ (Gate G3B static PASSED — 2026-07-10)

- ✅ Checkout (server-side pricing only), verify (timing-safe HMAC), webhook (raw-body HMAC, source of truth, 500-on-transient for redelivery, no IP limiter — HMAC is auth), CAS-idempotent capture (no double stock decrement under concurrency), `decrement_stock` RPC, order_events timeline, adjacent-only transitions.
- ✅ Frontend: Razorpay Checkout in OrderSummary (display total == charged amount), OrderTimeline component, order-placed flow.
- ✅ **Post-3B security audit: PASS** (no Critical/High). Mediums fixed: seller order responses scoped to own items + seller subtotal (M1); sellers restricted to fulfillment transitions, cancel/refund reserved for future admin path (M2). Lows fixed: OAuth open redirect (L3), webhook limiter/retry semantics (L4), `[ALERT][manual-review]` marker on decrement failure (L5).
- ⏸ **Gate G3B live half blocked on user:** Razorpay test-mode e2e (pay twice, webhook replay, tamper test) needs Razorpay test keys + linked Supabase.
- Known limitations (documented): stock validated at checkout but reserved only at capture; multi-seller orders share one fulfillment status.

## Phase 4 — Seller dashboard & reports ✅ (Gate G4 static PASSED — 2026-07-10)

- ✅ `/api/seller/stats` (revenue, order_count, paid_order_count, AOV per paid order, units, low-stock ≤5, status breakdown), `/api/seller/reports/sales` (day/week/month buckets, zero-filled), `/api/seller/reports/top-products` — all seller-isolated (own order_items only, never whole-order amounts).
- ✅ Dashboard page (stat cards + revenue AreaChart + status BarChart + low-stock), Reports page (date presets, interval, tables, client-side CSV export); Add Product moved to `/seller/add-product`; Sidebar updated. Recharts added.
- ✅ **Gate G4 (static):** 79/79 tests (incl. seller-isolation + paid-only AOV proofs), tsc clean, root build green. Reconciliation SQL prepared in commit history for the live-DB check once Supabase is linked.

## Phase 5 — QA + security release gate ✅ (2026-07-10)

- ✅ **Security release gate: PASS** — no Critical/High; all 9 prior audit fixes verified present (no regressions); git history clean of secrets; Phase 4 aggregates seller-isolated. Release-gate follow-ups fixed: CSV formula-injection escaping, paginated stats aggregation (no silent >1000-row truncation).
- ✅ **QA regression: 120/120 tests** (41 added: IDOR attempts on addresses/cart/orders, payload limits, transition chains, date boundaries, webhook edge cases). Manual live-stack script: `qa/manual-regression.md`.
- ✅ QA bugs fixed: webhook unknown-order 200-ack (no retry storm); errorHandler honors framework 4xx (413/400 no longer 500); ESLint flat config fixed — **`.jsx` files were previously never linted at all** (latent config bug, now covered) + Footer lint error; `addresses` wired into AppContext; hardcoded `$` → `{currency}`; catalog error state + Retry on home/all-products.
- Remaining non-blocking: `react-hooks/exhaustive-deps` warning in order-placed page.
- ⏸ Live-stack items deferred to deploy window (need user credentials): Gate G1 db push + RLS spot-check, Gate G3B Razorpay e2e, Gate G4 SQL reconciliation, manual regression run.

## Pending

- ⬜ Phase 6 — Deploy (`devops-engineer`) — Gate G6 — **blocked on user:** Supabase project link + env values, Razorpay keys (test for e2e, live for prod), Hostinger VPS access + domain.

## Needed from user

1. Supabase project: create it, then `npx supabase link --project-ref <ref>`; fill `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env` and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `server/.env`.
2. Razorpay **test-mode** key id + secret + webhook secret → `server/.env` (needed by Phase 3B; key id also as `NEXT_PUBLIC_RAZORPAY_KEY_ID`).
3. Rotate the old Clerk/Mongo/Cloudinary credentials that sat in the previously-unignored `.env`.
