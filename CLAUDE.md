# CLAUDE.md — QuickCart Production Build

## What this project is

QuickCart is an e-commerce platform being upgraded from a frontend-only Next.js UI shell (dummy data, empty handlers) to a full production system.

**Target architecture (locked — do not change without asking the user):**

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Next.js 15 (App Router) + Tailwind + React Context | Vercel (Hobby) |
| Backend API | Node 20 + Express 5 + TypeScript | Hostinger **VPS** (PM2 + Nginx + Let's Encrypt) |
| Database | Supabase Postgres (with RLS on every table) | Supabase Free/Pro |
| Auth | Supabase Auth (email/password + Google OAuth) | Supabase |
| File storage | Supabase Storage (`product-images` bucket) — replaces Cloudinary | Supabase |
| Payments | Razorpay (Orders API + Checkout.js + Webhooks) | — |
| Charts | Recharts (seller dashboard/reports) | — |

**Why this shape:** Supabase replaces MongoDB + Clerk + Cloudinary from the old scaffold (delete `lib/authSeller.js` and all Clerk/Mongo/Inngest references). The Express server on Hostinger owns all *privileged* logic: price calculation, stock mutation, Razorpay order creation, webhook handling, seller analytics. The frontend talks to Supabase directly **only** for auth sessions and public reads; everything money- or stock-related goes through the Express API.

## Repository layout

```
/                     → Next.js app (deployed to Vercel; Vercel ignores /server)
  app/                → routes (existing UI, keep the styling/structure)
  components/
  context/AppContext.jsx
  lib/supabase/       → browser + server Supabase clients (anon key only)
  lib/api.js          → thin fetch wrapper for the Express API (attaches JWT)
/server               → Express API (deployed to Hostinger VPS)
  src/index.ts
  src/middleware/     → auth (Supabase JWT verify), rateLimit, error handler
  src/routes/         → products, cart, addresses, orders, payments, seller
  src/lib/            → supabaseAdmin (service role), razorpay client
  src/validators/     → zod schemas (every request body/query is validated)
/supabase
  migrations/         → SQL migrations (schema + RLS policies + RPCs)
```

## Commands

```bash
npm run dev                 # Next.js dev (root)
npm run build && npm start  # Next.js prod build check
cd server && npm run dev    # Express dev (tsx watch)
cd server && npm run build  # tsc
cd server && npm test       # vitest + supertest
npx supabase db push        # apply migrations (linked project)
```

## Database schema (source of truth: /supabase/migrations)

- `profiles` — `id uuid PK → auth.users`, name, email, `role text check (role in ('user','seller'))` default `'user'`, created via DB trigger on auth signup.
- `products` — id, seller_id → profiles, name, description, category, price numeric, offer_price numeric, images text[], stock int, is_active bool, timestamps.
- `addresses` — id, user_id, full_name, phone, pincode, area, city, state.
- `cart_items` — user_id + product_id (unique pair), quantity.
- `orders` — id, user_id, address_id, amount numeric, currency, `status` (see below), payment_status (`pending|paid|failed|refunded`), razorpay_order_id, razorpay_payment_id, timestamps.
- `order_items` — order_id, product_id, quantity, `price_at_purchase` (snapshot — never join live price for history).
- `order_events` — order_id, status, note, created_at. **This is the order-tracking timeline.** Insert a row on every status change.

Order status enum: `pending → paid → processing → shipped → out_for_delivery → delivered`, plus `cancelled`, `refunded`.

### RLS rules (non-negotiable)
- RLS **enabled on every table**. No exceptions.
- Users: read/write only their own rows (`auth.uid() = user_id`).
- Products: public `SELECT` where `is_active = true`; sellers CRUD only their own rows.
- Orders/order_items/order_events: owner reads; sellers read rows containing their products; **all writes to orders/stock happen only via the service role on the server** (client has no insert/update policy on orders).
- Stock decrement is an atomic Postgres function (`decrement_stock`) called in the payment-capture path — never read-then-write from JS.

## Security rules (blocking — the security-auditor agent enforces these)

1. `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` exist **only** in `/server` env. Never in Next.js code, never in `NEXT_PUBLIC_*`.
2. Every Express route validates input with zod before touching the DB.
3. Auth middleware verifies the Supabase JWT (via `supabase.auth.getUser(token)` or JWKS) on every non-public route; seller routes additionally check `profiles.role = 'seller'` **from the DB**, never from client-supplied data.
4. Order amount is computed **server-side** from DB prices at checkout. The client never sends prices or totals.
5. Razorpay: verify checkout callback signature (HMAC-SHA256 of `order_id|payment_id` with key secret) AND verify webhook `X-Razorpay-Signature`. The **webhook is the source of truth** for `paid`; the callback is a UX fast-path only. Webhook handler must be idempotent (check `razorpay_payment_id` before mutating).
6. Express hardening: `helmet`, CORS allowlist (Vercel prod domain + localhost dev only), `express-rate-limit` (strict on `/payments` and auth-adjacent routes), body size limit 1mb, no `x-powered-by`.
7. Never log tokens, secrets, or full card/payment payloads.
8. All new server code is TypeScript with `strict: true`.

## Frontend conventions

- Keep the existing UI/Tailwind design — this is a wiring job, not a redesign.
- Replace every `setX(dummyData)` in `context/AppContext.jsx` and pages with real calls via `lib/api.js` / Supabase.
- Replace hardcoded `isSeller = true` with the profile role from Supabase session; gate `/seller/*` with a layout check + middleware.
- Loading/error/empty states for every fetch (the `Loading` component exists — use it). Toasts via existing `react-hot-toast`.
- Cart: keep the local Context engine for speed, sync to `cart_items` (debounced) when logged in; merge guest cart on login.
- Images: upload from seller Add Product page → Express endpoint → Supabase Storage → store public URLs in `products.images`.

## Payment + order tracking flow (canonical)

1. `POST /api/orders/checkout` (auth) → validate cart & stock from DB → create `orders` row (`pending`) + `order_items` snapshot → create Razorpay order → return `{ rzpOrderId, amount, keyId }`.
2. Frontend opens Razorpay Checkout (`NEXT_PUBLIC_RAZORPAY_KEY_ID`).
3. Success handler → `POST /api/payments/verify` → signature check → mark `paid`, decrement stock, insert `order_events`, clear cart → redirect `/order-placed`.
4. Webhook `POST /api/payments/webhook` (`payment.captured` / `payment.failed`) → idempotent reconcile (covers user closing the tab).
5. Seller updates status via `PATCH /api/seller/orders/:id/status` (valid transitions only) → inserts `order_events`.
6. Buyer's My Orders page renders the `order_events` timeline as the tracking UI.

## Environment variables

```
# Vercel (frontend)
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL              # https://api.<domain>
NEXT_PUBLIC_RAZORPAY_KEY_ID

# Hostinger VPS (server/.env — never committed)
PORT / NODE_ENV
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
CORS_ORIGIN                     # comma-separated allowlist
```

## Workflow rules for Claude

- Follow `ORCHESTRATION.md` for build order and delegate to the subagents in `.claude/agents/` per its phase table. Don't skip quality gates.
- Migrations only via new files in `/supabase/migrations` — never edit applied migrations.
- Small, reviewable commits per feature (`feat(server): checkout endpoint + tests`).
- Every server route ships with at least one happy-path and one auth/validation-failure test.
- When something in this file conflicts with old scaffold code (Clerk/Mongo/Inngest/Cloudinary), this file wins — delete the scaffold.
