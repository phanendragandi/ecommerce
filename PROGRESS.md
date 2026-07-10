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

## Pending

- ⬜ Phase 3A — Frontend wiring (`frontend-engineer`) — Gate G3A
- ⬜ Phase 3B — Payments & tracking (`payments-engineer`) — Gate G3B
- ⬜ Phase 4 — Seller dashboard (`dashboard-engineer`) — Gate G4
- ⬜ Phase 5 — QA + security release gate
- ⬜ Phase 6 — Deploy (`devops-engineer`) — Gate G6

## Needed from user

1. Supabase project: create it, then `npx supabase link --project-ref <ref>`; fill `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env` and `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `server/.env`.
2. Razorpay **test-mode** key id + secret + webhook secret → `server/.env` (needed by Phase 3B; key id also as `NEXT_PUBLIC_RAZORPAY_KEY_ID`).
3. Rotate the old Clerk/Mongo/Cloudinary credentials that sat in the previously-unignored `.env`.
