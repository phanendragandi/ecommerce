# QuickCart — Manual Regression Script

Run this once the live stack exists (Supabase project linked + migrations pushed,
Razorpay test-mode keys configured, `/server` deployed or running locally against
a real Supabase project, frontend pointed at that API). Every step lists the
action and the **expected result**. Check off `[ ]` → `[x]` as you go and record
actual result + screenshot/notes for any failure.

Environment assumptions: two test accounts — one plain buyer, one seller
(`profiles.role = 'seller'`), Razorpay in **test mode** (card `4111 1111 1111
1111`, any future expiry/CVV, or the UPI test handle). Reset cart/localStorage
between unrelated flows unless a step says otherwise.

---

## 1. Buyer journey

- [ ] 1.1 Visit `/` logged out. **Expected:** homepage loads with live product
      data (not dummy `assets/assets.js` placeholders); loading skeleton/spinner
      shows briefly then real products render.
- [ ] 1.2 `/signup` — create a new account with a valid email + password.
      **Expected:** account created, redirected/logged in, a `profiles` row
      exists with `role = 'user'`.
- [ ] 1.3 Browse `/all-products`, filter/search if available. **Expected:**
      only `is_active = true` products appear; images load from Supabase
      Storage public URLs.
- [ ] 1.4 Open a product detail page (`/product/[id]`). **Expected:** price,
      offer price, stock-derived "Add to cart" availability all match the
      seller's product list.
- [ ] 1.5 Add 2 different products to cart, one with quantity 2. **Expected:**
      cart badge count updates instantly (optimistic local update); `/cart`
      shows both line items with correct subtotal.
- [ ] 1.6 Refresh the page. **Expected:** cart persists (synced to
      `cart_items` for a logged-in user — debounced write, then reload reads
      it back).
- [ ] 1.7 Go to `/add-address`, submit a valid Indian address. **Expected:**
      `addresses` row created; redirected to `/cart` (per
      `app/add-address/page.jsx`); toast "Address saved".
- [ ] 1.8 On `/cart`, `OrderSummary` → select the new address → click **Place
      Order**. **Expected:** `POST /api/orders/checkout` succeeds; Razorpay
      Checkout modal opens with the amount matching the on-screen total
      exactly (no client-side price tampering possible — verify the amount
      shown in the Razorpay modal equals cart total, in paise ×100).
- [ ] 1.9 Pay with the Razorpay test card. **Expected:** success handler
      fires → `POST /api/payments/verify` returns 200 → cart clears →
      redirected to `/order-placed` → auto-redirects to `/my-orders` after
      ~5s.
- [ ] 1.10 On `/my-orders`, find the new order. **Expected:** status shows
      `paid` (or later, if the webhook already advanced it), amount matches
      what was charged, and the `OrderTimeline` component shows at least
      "Order Placed" and "Payment Confirmed" nodes with timestamps.
- [ ] 1.11 Confirm stock decremented: check the product's stock in the seller
      product list dropped by the ordered quantity exactly once (not twice).
- [ ] 1.12 Re-order the same product until stock hits 0, then attempt to add
      one more. **Expected:** UI blocks further increments ("No more stock
      available" toast) and/or checkout rejects with a clear error if
      attempted anyway.

## 2. Seller journey

- [ ] 2.1 Log in as the seller account. Visit `/seller`. **Expected:**
      dashboard loads (no redirect), stat cards show real numbers (Revenue,
      Orders, AOV, Units Sold), not zeros-by-default unless genuinely empty.
- [ ] 2.2 `/seller/add-product` — fill in name/description/category/price/
      offer price ≤ price/stock, attach 1–4 images (jpeg/png/webp, <5MB
      each). Submit. **Expected:** product created (`POST
      /api/seller/products` 201), then images upload (`POST
      /:id/images` 201) and the form resets with a success toast.
- [ ] 2.3 Try an offer price greater than the price. **Expected:** client-side
      validation blocks submit with a toast before any request fires.
- [ ] 2.4 `/seller/product-list`. **Expected:** the new product appears with
      its uploaded image, correct price, and category.
- [ ] 2.5 As the buyer, confirm the new product is visible on `/all-products`
      and its product page within a reasonable time (no caching lag beyond
      a page refresh).
- [ ] 2.6 Buyer places an order containing this seller's product (can be
      combined with another seller's product if multi-seller checkout is
      possible in your data set). Complete payment.
- [ ] 2.7 `/seller/orders` as the seller. **Expected:** the order appears;
      if the order also contained another seller's item, only THIS seller's
      line item(s) and a `seller_subtotal`-scoped amount are shown — never
      the co-seller's product name or the whole-order total.
- [ ] 2.8 Advance the order status via the dropdown: `paid → processing`.
      **Expected:** `PATCH /api/seller/orders/:id/status` 200, toast
      "Order status updated", the row updates optimistically.
- [ ] 2.9 Continue: `processing → shipped → out_for_delivery → delivered`,
      one step at a time. **Expected:** each transition succeeds; attempting
      to select a non-adjacent status (if the UI allowed it) is rejected by
      the server with 400.
- [ ] 2.10 As the buyer, refresh `/my-orders`. **Expected:** each status
      change is reflected in `OrderTimeline` with the seller's optional note
      and a timestamp, in the correct order.
- [ ] 2.11 `/seller` dashboard — confirm Revenue/Orders/AOV/Units Sold moved
      after the new paid order (Revenue/AOV must reflect ONLY `payment_status
      = 'paid'` orders; a `pending`/`cancelled` order must not move AOV).
      Confirm the "Orders by status" bar chart reflects the new status.
- [ ] 2.12 `/seller/reports` — try each date preset (7D/30D/90D) and a custom
      range, each interval (day/week/month). **Expected:** series/table
      re-fetch and update; totals in the top cards equal the sum of the
      bucketed table rows.
- [ ] 2.13 Click **Export CSV**. **Expected:** a `.csv` downloads containing
      the report header, the bucketed series, and the top-products table;
      open it in a spreadsheet app and confirm no cell beginning with `=`,
      `+`, `-`, or `@` is interpreted as a formula (product/bucket names with
      those leading characters, if any, should be prefixed with `'`).
- [ ] 2.14 Push a product's stock to ≤5 (via an order or a manual edit).
      **Expected:** it appears in the dashboard's "Low stock" table, sorted
      ascending by remaining stock.

## 3. Auth edge cases

- [ ] 3.1 **Guest cart merge:** while logged out, add 2 products to cart
      (stored in `localStorage`). Log in with an account that already has a
      different product in its server-side cart. **Expected:** after login,
      the cart contains the union of both (quantities summed for overlapping
      products, capped at each product's stock), and the guest
      `localStorage` cart is cleared.
- [ ] 3.2 **Wrong password:** attempt login with a valid email + wrong
      password. **Expected:** toast error, no session created, no redirect.
- [ ] 3.3 **OAuth cancel:** start "Continue with Google", cancel/deny on
      Google's consent screen. **Expected:** redirected back to `/login` (or
      `/login?error=auth_callback_failed`) with a toast, no partial session.
- [ ] 3.4 **Expired/invalid session:** manually clear/corrupt the Supabase
      auth cookie (or wait out token expiry) then call an authenticated
      action (e.g. add to cart, view `/my-orders`). **Expected:** the API
      returns 401 and the frontend either redirects to `/login` or shows a
      clear "please log in" state — never a silent failure or stale data.
- [ ] 3.5 **Non-seller hitting `/seller/*`:** log in as a plain buyer, browse
      directly to `/seller`, `/seller/orders`, `/seller/add-product`.
      **Expected:** `app/seller/layout.jsx` shows a loading state then
      redirects to `/` with a "Seller access required" toast — no flash of
      seller content.
- [ ] 3.6 **Direct API calls without a token:** using curl/Postman, call
      `GET /api/cart`, `GET /api/orders`, `GET /api/seller/stats` with no
      `Authorization` header. **Expected:** all return 401 JSON
      `{ success: false, message: ... }`, never a 200 or a stack trace.
- [ ] 3.7 **IDOR — address:** as user A, note an address id. As user B, call
      `DELETE /api/addresses/<A's id>` with B's token. **Expected:** 404 (not
      403 — the API must not confirm the row's existence), and A's address is
      untouched.
- [ ] 3.8 **IDOR — checkout with someone else's address:** as user B, call
      `POST /api/orders/checkout` with `address_id` belonging to user A.
      **Expected:** 404 "Address not found", no order created.
- [ ] 3.9 **Role escalation attempt:** as a plain buyer, try sending a
      client-supplied `role: "seller"` (or similar) field on any profile-
      touching request. **Expected:** ignored — role is only ever read from
      `profiles` server-side, never accepted from the client.

## 4. Payment edge cases

- [ ] 4.1 **Close tab after payment:** start checkout, complete payment in
      the Razorpay modal, then close the browser tab/window immediately
      (before the `verify` call's response arrives). **Expected:** the
      Razorpay webhook independently marks the order `paid` and decrements
      stock within a few seconds — reopen `/my-orders` and confirm the order
      shows `paid` even though `verify` never got a chance to run
      client-side.
- [ ] 4.2 **Replayed webhook:** using the Razorpay Dashboard's "Resend"
      feature (or replaying the same signed payload via curl against
      `/api/payments/webhook`) for an already-captured payment. **Expected:**
      200 response, but stock is NOT decremented a second time and no
      duplicate `order_events` "Payment captured" row is created.
- [ ] 4.3 **Tampered signature:** replay a webhook payload with the
      `X-Razorpay-Signature` header altered by even one character.
      **Expected:** 400, and confirm via logs/DB that no order was touched.
- [ ] 4.4 **Payment failure:** trigger a failing test card / cancel payment
      mid-flow. **Expected:** `payment.failed` webhook sets
      `payment_status = 'failed'`, order stays `pending`/unpaid, stock is
      untouched, and the buyer sees a "cancelled, you can retry" toast
      (dismiss handler) rather than a false success.
- [ ] 4.5 **Cart changes mid-checkout:** open checkout in one tab, then in
      another tab/device reduce the product's stock below the cart quantity
      (as the seller, edit stock down) before completing payment.
      **Expected:** payment capture still succeeds per the documented
      "advisory checkout-time check, hard guard at capture" design — confirm
      whether the stock RPC's failure path is triggered and that the order
      is still marked paid with a "manual review" note if so (see
      `capturePayment.ts`); this is a KNOWN LIMITATION, not a blocker, but
      confirm the manual-review log line appears so ops can reconcile.
- [ ] 4.6 **Zero-item / empty cart checkout:** clear the cart entirely, then
      try to trigger checkout (e.g. via a stale "Place Order" click or direct
      API call). **Expected:** blocked client-side ("Your cart is empty")
      and server-side (400 on empty `items` array).

## 5. Mobile viewport pass

Test at a phone width (375×667 or similar) in Chrome DevTools device mode
and, if available, one real device.

- [ ] 5.1 `/` (homepage) — nav collapses to a usable mobile menu, hero/banner
      images scale, product grid reflows to fewer columns, no horizontal
      scroll/overflow.
- [ ] 5.2 `/all-products` — product grid and search/filter controls remain
      usable and tappable (44px+ touch targets), no overlapping text.
- [ ] 5.3 `/cart` — the cart table remains usable (note: the desktop layout
      is a wide `<table>`; confirm it scrolls horizontally or reflows rather
      than clipping/overlapping) and `OrderSummary` stacks below the cart
      table rather than squeezing beside it.
- [ ] 5.4 `/my-orders` — order cards stack vertically, timeline nodes remain
      legible without horizontal overflow.
- [ ] 5.5 `/seller` (dashboard) — stat card grid drops to 2 or 1 columns,
      charts remain readable (not squashed to unreadable width), the sidebar
      collapses or remains accessible without covering content.

---

## Notes for the tester

- Record the Supabase project + Razorpay mode (test/live) used for this pass
  at the top of your results doc.
- Any failed step becomes a bug report: file/line if it's traceable to a
  specific component, exact repro steps, expected vs. actual, and severity.
- Re-run section 4 (payment edge cases) after any change to
  `server/src/lib/capturePayment.ts`, `server/src/routes/payments.ts`, or the
  Razorpay webhook configuration — this is the highest-risk area (money +
  idempotency).
