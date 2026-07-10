# QuickCart — Production Go-Live Runbook

Read this top to bottom, in order, the first time you deploy. Every step is
a fill-in-the-blanks exercise — no real domains/credentials exist yet, so
this file (and every config it references) uses obvious placeholders:

- `<DOMAIN>` — the frontend domain, e.g. `quickcart.example.com` (or an apex domain)
- `<API_DOMAIN>` — the API subdomain, e.g. `api.quickcart.example.com`
- `<VPS_IP>` — the Hostinger VPS's public IPv4 address
- `<REPO_URL>` — your git remote, e.g. `git@github.com:<org>/quickcart.git`

Related docs: `CLAUDE.md` (architecture + security rules — this runbook does
not restate them, it just points at where each one gets enforced),
`ORCHESTRATION.md` Phase 6 / Gate G6, `PROGRESS.md` (current build status —
as of writing, everything through Phase 5 is done; Phase 6 is blocked only
on the credentials this runbook collects), `qa/manual-regression.md` (the
full manual test script referenced by the smoke test section below).

---

## 0. Hosting type sanity check (do this first)

This deploy target is a Hostinger **VPS** (KVM) plan with root SSH access —
Node/Express needs a real, persistent process (PM2) and the ability to bind
ports and run systemd services. If what was actually purchased is Hostinger
**shared hosting** (hPanel "Web Hosting" plans — PHP/CGI, no SSH root, no
systemd), **stop here**: none of `deploy/setup-vps.sh` will work, and there
is no way to run a long-lived Express API on shared hosting. Upgrade to a
VPS plan (the cheapest KVM tier is sufficient — 1 vCPU / 1GB RAM) before
continuing. Check the Hostinger panel for an "SSH Access" section showing a
root password/IP; if that's absent, you have shared hosting.

---

## 1. Supabase project

1.1. Create the project at https://supabase.com/dashboard (free tier is
     fine to start — see §11 on when to upgrade to Pro).

1.2. Note the project's:
     - Project URL → will become `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`.
     - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
     - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (VPS **only**, never Vercel, never `NEXT_PUBLIC_*`).

1.3. Link the repo's local Supabase CLI to the project and push migrations:

    ```bash
    npx supabase login
    npx supabase link --project-ref <your-project-ref>
    npx supabase db push
    ```

    This applies, in order, everything in `supabase/migrations/`: schema +
    `order_status` enum + indexes, the `handle_new_user` signup trigger, the
    atomic `decrement_stock` RPC, full RLS policy set, and the
    `product-images` storage bucket + policies.

1.4. **Seed data decision.** `supabase/seed.sql` is guarded to refuse
     running against a non-local database (see the warning header in that
     file) — it is a local-dev convenience (`npx supabase db reset`), **not**
     something to run against the hosted project. For production, decide
     one of:
     - Start with an empty catalog and let the seller create real products
       via `/seller/add-product`, or
     - Manually adapt the product-insert portion of `seed.sql` into a
       one-off script pointed at a real seller's `profiles.id` (do not
       reuse the demo-seller `auth.users` insert — that creates a
       publicly-known-password login).

1.5. **RLS spot-check** (run in the Supabase SQL editor against the linked
     project, as referenced in `PROGRESS.md` Phase 1 / Gate G1). At minimum:

    ```sql
    -- As anon (no JWT): must return 0 rows — anon cannot read others' orders.
    set role anon;
    select count(*) from public.orders;

    -- As an authenticated non-owner: must return 0 rows for someone else's order.
    -- (swap in a real second user's JWT via the dashboard's "Run as user" picker)

    -- Client-side insert into orders must be REJECTED (no insert policy —
    -- all order writes are service-role only, per CLAUDE.md).
    insert into public.orders (user_id, address_id, amount, currency)
    values (auth.uid(), '00000000-0000-0000-0000-000000000000', 1, 'INR');
    -- expected: permission denied / policy violation

    reset role;
    ```

    Cross-check against `PROGRESS.md` Phase 1 notes (storage write policies
    are owner-per-path `<seller_id>/<filename>` — verify a seller cannot
    upload under another seller's UUID prefix).

1.6. **Storage bucket verification.** In Supabase Studio → Storage, confirm
     `product-images` exists, is **public** (read), and that the bucket
     policies match `supabase/migrations/20260710000005_storage.sql`
     (owner-scoped write/delete by `<seller_id>/...` path prefix). Upload a
     test image as a seller via the app once deployed and confirm the
     returned public URL resolves.

1.7. **Supabase Auth configuration:**
     - Email/password: enabled by default — no action needed.
     - Google OAuth: Authentication → Providers → Google. Create OAuth
       credentials in the Google Cloud Console (OAuth consent screen +
       Web application client), set the **Authorized redirect URI** there
       to the Supabase-provided callback (`https://<project-ref>.supabase.co/auth/v1/callback`),
       then paste the Google Client ID + Secret into the Supabase provider
       config.
     - **Redirect URLs allowlist** (Authentication → URL Configuration →
       Redirect URLs) — the frontend calls `signInWithOAuth` with
       `redirectTo: ${origin}/auth/callback` (see `app/login/page.jsx`,
       `app/signup/page.jsx`), so register **every** origin that will call
       it:
       - `https://<DOMAIN>/auth/callback` (production)
       - `https://*.vercel.app/auth/callback` or the specific preview
         domain pattern your Vercel project uses (Preview deployments get
         a unique `*.vercel.app` URL per deploy — see §2 for how to find
         the stable pattern) — needed so OAuth login works when testing a
         PR preview, not just prod.
       - `http://localhost:3000/auth/callback` (local dev)
     - Site URL: set to `https://<DOMAIN>`.

---

## 2. Vercel (frontend)

Project settings (Vercel dashboard → your project → Settings):

- **Root Directory:** repo root (the `app/` Next.js App Router lives at the
  top level — do not set this to `/server`). `vercel.json` at the repo root
  adds an `ignoreCommand` so a commit touching only `/server`, `/supabase`,
  `/qa`, or `/deploy` skips a Vercel build entirely (saves Hobby build
  minutes); `.vercelignore` excludes those same paths from the upload.
  Nothing else in `vercel.json` is needed — Next.js 15 App Router is
  auto-detected (build command `next build`, output handled automatically).
- **Framework Preset:** Next.js (auto-detected).
- **Build Command:** default (`next build` / `npm run build`) — no override needed.
- **Install Command:** default (`npm ci` / `npm install`) — no override needed.
- **Node.js Version:** 20.x.

**Environment variables** (Settings → Environment Variables — set for both
*Production* and *Preview*, values differ only where noted):

| Name | Production value | Preview value |
|---|---|---|
| `NEXT_PUBLIC_CURRENCY` | `₹` (or your symbol) | same |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (§1.2) | same project (or a staging project if you have one) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | same |
| `NEXT_PUBLIC_API_URL` | `https://<API_DOMAIN>` | same (single VPS serves both prod + preview unless you stand up a second API) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Razorpay **live** key id (§9) | Razorpay **test** key id — do not expose a live key id to preview builds anyone can open |

All of these are `NEXT_PUBLIC_*` by design — they are safe to expose in the
client bundle (anon key + publishable key id only; RLS and Razorpay secret
verification are what actually gate access, not secrecy of these values).
Per CLAUDE.md, `SUPABASE_SERVICE_ROLE_KEY` / `RAZORPAY_KEY_SECRET` /
`RAZORPAY_WEBHOOK_SECRET` must **never** appear here.

**Domains:** Settings → Domains → add `<DOMAIN>` (and `www.<DOMAIN>` if
desired, redirecting to the apex or vice versa — Vercel's UI offers this).
Follow Vercel's own DNS instructions there (it will show either an `A`
record to Vercel's IP, or a `CNAME` to `cname.vercel-dns.com`, depending on
whether `<DOMAIN>` is an apex or subdomain) — see §7 for the corresponding
DNS step at your registrar/Hostinger DNS panel.

Once both the production domain and the preview-deployment domain pattern
are known, go back to §1.7 and confirm both are in the Supabase redirect
allowlist.

---

## 3. VPS provisioning

3.1. Order/confirm a Hostinger **VPS** plan (see §0), note its IP as
     `<VPS_IP>`, and get root SSH access working:

    ```bash
    ssh root@<VPS_IP>
    ```

3.2. From your local machine, copy the provisioning script up and run it:

    ```bash
    scp deploy/setup-vps.sh root@<VPS_IP>:/root/setup-vps.sh
    ssh root@<VPS_IP>
    chmod +x /root/setup-vps.sh
    DEPLOY_USER=deploy REPO_URL=<REPO_URL> GIT_BRANCH=main /root/setup-vps.sh
    ```

    This installs Node 20, Nginx, UFW (22/80/443 only), fail2ban (sshd
    jail), certbot, creates the `deploy` user, sets up SSH key auth (it will
    pause and ask you to confirm key-based login works before disabling
    password auth — do this in a **second terminal** so you don't lock
    yourself out), clones the repo, builds `/server`, installs PM2 globally,
    registers `pm2 startup`, and installs `pm2-logrotate`. Re-running it
    later is safe — every step checks current state first.

    If it pauses at the clone step because `REPO_URL` wasn't reachable yet
    (e.g. private repo, deploy key not added), add a deploy key to the
    GitHub repo (Settings → Deploy keys) matching a keypair generated on the
    VPS (`ssh-keygen -t ed25519 -C "quickcart-vps"` as the `deploy` user,
    then paste `~/.ssh/id_ed25519.pub` into GitHub), then re-run the script.

3.3. From here on, SSH in as `deploy@<VPS_IP>`, not root, for all app-level
     work.

---

## 4. server/.env (secrets)

On the VPS, as the `deploy` user:

```bash
touch /var/www/quickcart/server/.env
chmod 600 /var/www/quickcart/server/.env
```

Populate it (this file is never committed — it lives only on the VPS,
outside anything Nginx serves as static content, and is the *only* place
these particular secrets exist besides Razorpay's own dashboard and
Supabase's own dashboard):

```bash
# /var/www/quickcart/server/.env — chmod 600, owned by the deploy user.
PORT=4000
NODE_ENV=production

SUPABASE_URL=<from Supabase §1.2>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase §1.2 — service_role secret>

RAZORPAY_KEY_ID=<from Razorpay §9>
RAZORPAY_KEY_SECRET=<from Razorpay §9>
RAZORPAY_WEBHOOK_SECRET=<from Razorpay §9>

# Exact-match origins only — server/src/config.ts THROWS on startup if any
# entry is "*". Comma-separated, no trailing slash.
CORS_ORIGIN=https://<DOMAIN>
```

Confirm the permission stuck: `ls -l /var/www/quickcart/server/.env` should
show `-rw------- deploy deploy`.

`CORS_ORIGIN` must be the **exact** Vercel production domain (scheme +
host, no path, no wildcard) — e.g. `https://<DOMAIN>` — not a `*.vercel.app`
pattern. If you also want preview deployments to be able to call the live
API during testing, add the specific preview URL as an additional
comma-separated entry; don't widen it to a wildcard (the config layer
actively rejects `*`).

---

## 5. DNS

At your DNS provider (Hostinger's DNS panel, or wherever `<DOMAIN>` is
registered), create:

| Type | Host | Value | Notes |
|---|---|---|---|
| A | `api` (→ `<API_DOMAIN>`) | `<VPS_IP>` | points the API subdomain at the VPS |
| A or CNAME | `@` / `www` (→ `<DOMAIN>`) | per Vercel's instructions (§2) | Vercel shows the exact record type/value once you add the domain in its dashboard — apex domains typically need an `A` record to Vercel's IP or `ALIAS`/`ANAME`, subdomains a `CNAME` to `cname.vercel-dns.com` |

Wait for propagation (`dig api.<API_DOMAIN>` or `nslookup`) before running
certbot in §6 — the HTTP-01 challenge needs the A record live.

---

## 6. Nginx + certbot (HTTPS for the API)

On the VPS, as `deploy` (with `sudo` where noted):

```bash
sudo cp /var/www/quickcart/deploy/nginx-quickcart-api.conf /etc/nginx/sites-available/quickcart-api
# Edit the copy and replace <API_DOMAIN> with the real subdomain:
sudo sed -i 's/<API_DOMAIN>/api.<DOMAIN>/g' /etc/nginx/sites-available/quickcart-api
sudo ln -sf /etc/nginx/sites-available/quickcart-api /etc/nginx/sites-enabled/quickcart-api
sudo nginx -t && sudo systemctl reload nginx
```

Confirm plain HTTP works first: `curl http://api.<DOMAIN>/health` (PM2
hasn't started the app yet at this point in a fresh run — that's fine, a
502 here just confirms Nginx itself is routing correctly; do §8 first if
you want a 200 before running certbot).

Then get the certificate:

```bash
sudo certbot --nginx -d api.<DOMAIN>
```

Certbot rewrites `/etc/nginx/sites-available/quickcart-api` in place to add
the `listen 443 ssl` block and an HTTP→HTTPS redirect (see the reference
block in the bottom comment of `deploy/nginx-quickcart-api.conf` for what
it looks like) and installs its own systemd timer for renewal. Verify
auto-renew is wired up:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

---

## 7. PM2

As `deploy`:

```bash
cd /var/www/quickcart/server
pm2 start ../deploy/ecosystem.config.js --env production
pm2 save
```

`pm2 startup` was already registered by `setup-vps.sh` (§3.2), so the
process survives a VPS reboot. `pm2 save` snapshots the current process
list so `pm2 resurrect` (run automatically by the startup service) restores
exactly this app on boot.

Verify:

```bash
pm2 status
curl http://127.0.0.1:4000/health          # direct to Node, bypassing Nginx
curl https://api.<DOMAIN>/health           # through Nginx + TLS
```

Both should return `{"success":true,"status":"ok"}`.

> **Naming note:** this runbook (and the health-check code in
> `server/src/app.ts`) uses `/health`, not `/healthz`. If you wire up an
> external uptime monitor, point it at `https://api.<DOMAIN>/health`.

---

## 8. Razorpay dashboard configuration

8.1. Start in **Test Mode** for Gate G6's first pass (§10), then switch to
     live keys once the smoke test passes.

8.2. API Keys (Settings → API Keys): generate a key pair.
     - `RAZORPAY_KEY_ID` → `server/.env` **and** Vercel's
       `NEXT_PUBLIC_RAZORPAY_KEY_ID` (this half is meant to be public — it's
       what Checkout.js uses client-side).
     - `RAZORPAY_KEY_SECRET` → `server/.env` **only**. Never in the
       frontend, never committed.

8.3. Webhooks (Settings → Webhooks → Add New Webhook):
     - URL: `https://api.<DOMAIN>/api/payments/webhook`
     - Active events: at minimum `payment.captured` and `payment.failed`
       (matches the handler in `server/src/routes/payments.ts`).
     - Secret: generate one in the Razorpay dashboard and put the **same**
       value in `server/.env` as `RAZORPAY_WEBHOOK_SECRET` — the webhook
       handler HMAC-verifies `X-Razorpay-Signature` against this exact
       secret; a mismatch here means every webhook delivery gets rejected
       with 400 and orders never reconcile past `pending`/fast-path verify.

8.4. **Live cutover:** when ready to accept real money, generate a second
     (live-mode) key pair + live webhook (Razorpay separates test/live
     completely, including webhooks), and swap all three values in
     `server/.env` (VPS only) plus `NEXT_PUBLIC_RAZORPAY_KEY_ID` in Vercel's
     **Production** environment variables. Redeploy the server
     (`deploy/deploy.sh`) and redeploy Vercel (any push, or "Redeploy" in
     the dashboard) after swapping. Keep test-mode keys around for future
     staging use — do not put live keys in any Preview environment.

---

## 9. Gate G6 smoke test

Per `ORCHESTRATION.md` Phase 6: **signup → buy (test-mode, or ₹1 live) →
webhook received → seller marks shipped → buyer sees timeline.** Run the
relevant sections of `qa/manual-regression.md` (§1 Buyer journey through
the checkout/order steps, plus the seller-ships-order and tracking-timeline
sections) against the real deployed stack — not localhost.

Minimum pass checklist:

- [ ] `https://<DOMAIN>` loads, real product data (not `assets/assets.js` dummies).
- [ ] Sign up a fresh account (email/password) → `profiles` row created with `role='user'`.
- [ ] Add to cart, add address, checkout → Razorpay Checkout opens with the correct amount.
- [ ] Pay with a Razorpay test card (test mode) or ₹1 live transaction.
- [ ] `POST /api/payments/verify` fast-path marks the order `paid` immediately (check `pm2 logs quickcart-api`).
- [ ] Confirm the **webhook** also fired and was accepted: `pm2 logs quickcart-api | grep webhook` should show no signature-mismatch errors, and the Razorpay dashboard's webhook log should show a `200` response — this is the source of truth per CLAUDE.md, not just the verify fast-path.
- [ ] Stock decremented exactly once (webhook redelivery must not double-decrement — this was already proven in Gate G3B's automated tests; the smoke test here just confirms it end-to-end on the real stack).
- [ ] Seller account (existing seller or promote a test account via SQL: `update profiles set role='seller' where id='<uuid>'`) sees the order and can advance its status.
- [ ] Buyer's My Orders page shows the updated `order_events` timeline.
- [ ] CORS: confirm the frontend at `https://<DOMAIN>` can call the API (no CORS console errors) and that a request from a random Origin is rejected (`CORS_ORIGIN` exact-match is doing its job).

If any step fails, do **not** flip Razorpay to live keys — fix and re-run.

---

## 10. Ongoing operations

- **Logs:** `pm2 logs quickcart-api` (live tail) or `pm2 logs quickcart-api --lines 200 --nostream`. Log rotation is handled by the `pm2-logrotate` module installed in `setup-vps.sh` (10MB per file, 14 files retained, gzip'd) — no manual logrotate cron needed.
- **Watch for `[ALERT][manual-review]`** in the logs — this exact marker is emitted by `server/src/lib/capturePayment.ts` when a payment was successfully captured but the stock-decrement RPC failed afterward (buyer charged, stock not adjusted — order is left `paid` and needs a human to reconcile stock manually). Grep for it in monitoring: `pm2 logs quickcart-api --nostream | grep '\[ALERT\]'`. Consider piping PM2 logs to a log-shipping/alerting tool later; at minimum, check for this marker after every deploy and periodically.
- **Webhook retry semantics** (from `server/src/routes/payments.ts`): a bad signature or malformed body returns `400` (Razorpay will not usefully retry a signature failure — that means the shared secret is wrong, fix `RAZORPAY_WEBHOOK_SECRET`). An unknown `order_id` (e.g. a stale/foreign event) is acknowledged with `200` so Razorpay stops retrying, but logs a `[webhook] unknown order acknowledged` warning — grep for that too if webhooks seem to be silently no-op'ing. A genuine processing error (DB hiccup, etc.) returns `500`, which **is** meant to trigger a Razorpay redelivery retry — transient errors should self-heal on the next delivery; persistent `500`s need investigation.
- **Uptime monitoring:** point a free monitor at `https://api.<DOMAIN>/health` (not `/healthz` — see the naming note in §7) and separately at `https://<DOMAIN>` for the frontend. Any of the well-known free tiers work for a project this size — e.g. UptimeRobot (50 monitors free, 5-min interval) or Better Stack's free tier; pick one, set a 5-minute check interval, and alert to an email/Slack you actually watch. This is a suggestion, not a hard dependency — swap for whatever you already use.
- **Redeploys:** `ssh deploy@<VPS_IP>` then `/var/www/quickcart/deploy/deploy.sh` (git pull, npm ci, build, test — aborts before touching the live process if tests fail — `pm2 reload` for zero-downtime, health-check with retry, rollback command printed on failure). See `.github/workflows/ci.yml`'s commented-out optional deploy job if you want this triggered automatically on merge to `main` instead of run by hand.
- **Backups:** Supabase free tier does **not** include point-in-time recovery (PITR) — you get daily backups retained for a short window, and no self-serve restore UI on some plans. Once the store is taking real revenue, upgrade to **Supabase Pro** specifically for PITR (continuous backup, restore to any point in the retention window) — this is the recommended trigger point, not "upgrade eventually." Until then, periodically export a logical backup yourself as a stopgap: `npx supabase db dump --linked -f backup-$(date +%F).sql` (or use `pg_dump` directly against the connection string from the Supabase dashboard), stored somewhere off the VPS (it currently isn't backed up anywhere in this plan).

---

## Appendix — quick reference

| What | Where it's set | Where it's enforced/consumed |
|---|---|---|
| `CORS_ORIGIN` | `server/.env` (VPS) | `server/src/config.ts` (throws on `*`), `server/src/app.ts` (`cors()` middleware) |
| Webhook URL | Razorpay dashboard | `server/src/app.ts` mounts `POST /api/payments/webhook` with `express.raw()` |
| `RAZORPAY_WEBHOOK_SECRET` | `server/.env` (VPS) + Razorpay dashboard (must match) | `server/src/routes/payments.ts` HMAC verify |
| Supabase redirect URLs | Supabase dashboard → Auth → URL Configuration | `app/login/page.jsx`, `app/signup/page.jsx` (`redirectTo`) |
| `NEXT_PUBLIC_*` | Vercel dashboard env vars | client bundle at build time |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/.env` (VPS) only | `server/src/lib/supabaseAdmin.ts` |
