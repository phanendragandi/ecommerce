# ORCHESTRATION.md — QuickCart Build Plan

The main Claude Code session acts as **orchestrator**: it plans, delegates to the subagents in `.claude/agents/`, reviews their output against the quality gates, and integrates. Agents never skip a phase gate.

## Agent roster

| Agent | Owns | Model | Write access |
|---|---|---|---|
| `supabase-architect` | Schema, migrations, RLS, RPCs, storage, auth config | opus | yes (migrations only) |
| `backend-engineer` | Express API, middleware, validators | sonnet | yes (`/server`) |
| `payments-engineer` | Razorpay checkout, verify, webhook, order tracking | opus | yes (`/server` payments + frontend checkout) |
| `frontend-engineer` | Auth UI, data wiring, cart sync, seller gating | sonnet | yes (frontend) |
| `dashboard-engineer` | Seller dashboard, reports, CSV export | sonnet | yes (dashboard scope) |
| `qa-engineer` | Tests (vitest/supertest), manual test scripts | sonnet | yes (test files only) |
| `security-auditor` | Release gate review | opus | **read-only** |
| `devops-engineer` | Vercel config, VPS setup, Nginx, PM2, CI | sonnet | yes (config/infra files) |

## Phases

### Phase 0 — Cleanup & scaffold (orchestrator, ~small)
- Delete dead scaffold: `lib/authSeller.js`, Clerk/Mongo/Inngest/Cloudinary env keys.
- Scaffold `/server` (Express + TS + zod + helmet + rate-limit + vitest) and `/supabase/migrations`.
- Add `lib/supabase/` clients + `lib/api.js` on the frontend.
- **Gate G0:** `npm run build` (root) and `server npm run build` both pass; repo layout matches CLAUDE.md.

### Phase 1 — Data layer (`supabase-architect`)
- Migrations for all tables + enum, signup trigger → `profiles`, `decrement_stock` RPC, indexes (products.category, orders.user_id, order_items.order_id).
- Full RLS policy set. Storage bucket `product-images` (public read, authenticated seller write).
- Seed script converting `assets/assets.js` dummy products into real rows.
- **Gate G1:** `supabase db push` clean; security-auditor spot-checks RLS (anon cannot read others' orders; client cannot insert orders).

### Phase 2 — Core API (`backend-engineer`)
- Middleware: JWT verify, `requireSeller`, error handler, rate limits, CORS.
- Routes: `GET /products`, `GET /products/:id`, seller product CRUD (+ image upload → Storage), addresses CRUD, cart sync (`GET/PUT /cart`), `GET /me`.
- **Gate G2:** supertest suite green (happy path + 401/403 + zod 400 per route).

### Phase 3A — Frontend wiring (`frontend-engineer`) — parallel with 3B
- Login/signup pages (Supabase email + Google), session in AppContext, replace `isSeller=true` with real role, guard `/seller/*`.
- Replace all dummy-data fetches; guest-cart merge on login; address form submit; My Orders from API.
- **Gate G3A:** every page loads real data; no `dummyData` references remain outside seed script.

### Phase 3B — Payments & tracking (`payments-engineer`) — parallel with 3A
- `POST /orders/checkout`, `POST /payments/verify`, `POST /payments/webhook` (idempotent), `PATCH /seller/orders/:id/status` with transition validation + `order_events`.
- Frontend: Razorpay Checkout in `OrderSummary.createOrder`, order-placed page, tracking timeline component on My Orders.
- **Gate G3B:** Razorpay test-mode end-to-end works twice (webhook replay = no double stock decrement); signature-tamper test returns 400.

### Phase 4 — Seller dashboard & reports (`dashboard-engineer`)
- Aggregate endpoints: `/seller/stats` (revenue, orders, AOV, low-stock), `/seller/reports/sales?from&to&interval`, top products, status breakdown.
- Dashboard page (Recharts) + Reports page with date range + CSV export.
- **Gate G4:** numbers reconcile with raw SQL against seeded orders.

### Phase 5 — QA + security (release gate)
- `qa-engineer`: full regression (buyer journey, seller journey, auth edge cases, mobile viewport).
- `security-auditor`: run its full checklist; **any Critical/High finding blocks Phase 6** and routes back to the owning agent.

### Phase 6 — Deploy (`devops-engineer`)
- Vercel: env vars, root deploy ignoring `/server`.
- Hostinger VPS: Node 20, PM2 ecosystem file, Nginx reverse proxy + HTTPS (Let's Encrypt), UFW (22/80/443), fail2ban, deploy script or GitHub Action.
- Razorpay live keys + webhook URL; Supabase auth redirect URLs for prod domain.
- **Gate G6:** production smoke test — signup → buy (₹1 live or test-mode) → webhook received → seller marks shipped → buyer sees timeline.

## Orchestrator rules
- Prefer sequential phases; only 3A/3B run in parallel (they touch disjoint files — coordinate the `OrderSummary`/checkout boundary explicitly).
- After each agent returns, orchestrator reviews the diff against CLAUDE.md security rules before committing.
- If an agent proposes a stack change (new DB, new payment provider, TS→JS, etc.), stop and ask the user.
- Keep a `PROGRESS.md` checklist updated at the end of each phase.
