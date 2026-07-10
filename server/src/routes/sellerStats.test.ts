import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORDER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORDER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function sellerClient(id = 'seller-1') {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id, email: 's@b.com' });
  return client;
}

function nonSellerClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'user-1', email: 'u@b.com' });
  return client;
}

describe('/api/seller/stats', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('200 computes revenue/order_count/aov/units_sold/status_breakdown/low_stock from ONLY the seller\'s items', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
      .mockReturnValueOnce(
        ok([
          { id: PRODUCT_ID, name: 'Widget', stock: 3, is_active: true }, // low stock
          { id: 'p-2', name: 'Gadget', stock: 20, is_active: true },
        ]),
      ) // seller products
      .mockReturnValueOnce(
        ok([
          // Order A: paid, 2 items for this seller's product (qty 2 @ 50)
          {
            order_id: ORDER_A,
            quantity: 2,
            price_at_purchase: 50,
            orders: { status: 'paid', payment_status: 'paid' },
          },
          // Order B: shipped + paid — contributes to revenue and order_count
          {
            order_id: ORDER_B,
            quantity: 1,
            price_at_purchase: 100,
            orders: { status: 'shipped', payment_status: 'paid' },
          },
          // Order C: pending payment — counts toward order_count/status but NOT revenue
          {
            order_id: ORDER_C,
            quantity: 5,
            price_at_purchase: 999,
            orders: { status: 'pending', payment_status: 'pending' },
          },
        ]),
      ); // order_items joined to orders
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/stats').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    // revenue = 2*50 + 1*100 = 200 (order C excluded — not paid)
    expect(res.body.data.revenue).toBe(200);
    // order_count = distinct orders containing their items, any status = 3
    expect(res.body.data.order_count).toBe(3);
    // paid_order_count = distinct PAID orders only (A, B) — order C is pending
    expect(res.body.data.paid_order_count).toBe(2);
    // aov = revenue / paid_order_count (NOT order_count) = 200 / 2 = 100
    expect(res.body.data.aov).toBe(100);
    // units_sold = paid-only units = 2 + 1 = 3
    expect(res.body.data.units_sold).toBe(3);
    expect(res.body.data.status_breakdown).toMatchObject({ paid: 1, shipped: 1, pending: 1 });
    expect(res.body.data.low_stock).toEqual([{ id: PRODUCT_ID, name: 'Widget', stock: 3 }]);
  });

  it('200 returns zeroed stats when the seller has no products', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok([])); // no products
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/stats').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toBe(0);
    expect(res.body.data.order_count).toBe(0);
    expect(res.body.data.paid_order_count).toBe(0);
    expect(res.body.data.aov).toBe(0);
    expect(res.body.data.units_sold).toBe(0);
    expect(res.body.data.low_stock).toEqual([]);
  });

  it("seller isolation: another seller's items never contribute to stats", async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID, name: 'Widget', stock: 10, is_active: true }])) // ONLY this seller's product returned (query scoped by seller_id)
      .mockReturnValueOnce(
        ok([
          {
            order_id: ORDER_A,
            quantity: 1,
            price_at_purchase: 10,
            orders: { status: 'paid', payment_status: 'paid' },
          },
        ]),
      ); // order_items scoped to `.in('product_id', productIds)` — other seller's product id never appears
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/stats').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toBe(10);
    expect(res.body.data.paid_order_count).toBe(1);
    expect(res.body.data.aov).toBe(10);
    expect(JSON.stringify(res.body)).not.toContain(OTHER_PRODUCT_ID);
  });

  it('aov uses the PAID-only order count, not the all-statuses order_count (many unpaid orders must not dilute it)', async () => {
    const client = sellerClient();
    const CANCELLED_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const CANCELLED_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const CANCELLED_C = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID, name: 'Widget', stock: 20, is_active: true }]))
      .mockReturnValueOnce(
        ok([
          // 1 paid order worth 100.
          {
            order_id: ORDER_A,
            quantity: 1,
            price_at_purchase: 100,
            orders: { status: 'paid', payment_status: 'paid' },
          },
          // 3 cancelled/pending orders inflate order_count but must not
          // dilute aov (aov must stay 100, not 100/4 = 25).
          {
            order_id: CANCELLED_A,
            quantity: 1,
            price_at_purchase: 500,
            orders: { status: 'cancelled', payment_status: 'refunded' },
          },
          {
            order_id: CANCELLED_B,
            quantity: 1,
            price_at_purchase: 500,
            orders: { status: 'pending', payment_status: 'pending' },
          },
          {
            order_id: CANCELLED_C,
            quantity: 1,
            price_at_purchase: 500,
            orders: { status: 'cancelled', payment_status: 'failed' },
          },
        ]),
      );
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/stats').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toBe(100);
    expect(res.body.data.order_count).toBe(4);
    expect(res.body.data.paid_order_count).toBe(1);
    expect(res.body.data.aov).toBe(100);
  });

  it('paginates order_items past the Supabase 1000-row default cap (full page + partial page both aggregated)', async () => {
    const client = sellerClient();
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      order_id: `order-${i}`,
      quantity: 1,
      price_at_purchase: 1,
      orders: { status: 'paid', payment_status: 'paid' },
    }));
    const partialPage = Array.from({ length: 5 }, (_, i) => ({
      order_id: `order-${1000 + i}`,
      quantity: 1,
      price_at_purchase: 1,
      orders: { status: 'paid', payment_status: 'paid' },
    }));

    client.from
      .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID, name: 'Widget', stock: 20, is_active: true }])) // seller products
      .mockReturnValueOnce(ok(fullPage)) // order_items page 1: exactly 1000 rows — must fetch another page
      .mockReturnValueOnce(ok(partialPage)); // order_items page 2: short page — stop here
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/stats').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    // Both pages' 1005 rows must be aggregated, not just the first 1000.
    expect(res.body.data.revenue).toBe(1005);
    expect(res.body.data.order_count).toBe(1005);
    expect(res.body.data.paid_order_count).toBe(1005);
    expect(res.body.data.units_sold).toBe(1005);
    // Exactly 4 `.from()` calls: requireSeller + products + 2 order_items pages
    // (no unnecessary 3rd page fetch after the short page).
    expect(client.from).toHaveBeenCalledTimes(4);
  });

  it('401 without a token', async () => {
    const res = await request(app).get('/api/seller/stats');
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a seller', async () => {
    const client = nonSellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'user' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/stats').set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });
});

describe('/api/seller/reports/sales', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('200 returns a zero-filled, time-bucketed series (day interval) scoped to paid orders', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID }])) // seller product ids
      .mockReturnValueOnce(
        ok([
          {
            order_id: ORDER_A,
            quantity: 2,
            price_at_purchase: 25,
            orders: { created_at: '2026-07-02T10:00:00Z', payment_status: 'paid' },
          },
          {
            order_id: ORDER_B,
            quantity: 1,
            price_at_purchase: 40,
            orders: { created_at: '2026-07-02T18:00:00Z', payment_status: 'paid' },
          },
          // Not paid — excluded from revenue/units/orders.
          {
            order_id: ORDER_C,
            quantity: 9,
            price_at_purchase: 999,
            orders: { created_at: '2026-07-03T00:00:00Z', payment_status: 'pending' },
          },
        ]),
      );
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-01', to: '2026-07-03', interval: 'day' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    const series = res.body.data.series;
    expect(series).toHaveLength(3); // zero-filled: 07-01, 07-02, 07-03
    expect(series.map((b: any) => b.bucket)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(series[0]).toMatchObject({ revenue: 0, units: 0, orders: 0 });
    // 07-02 aggregates both paid orders: revenue = 2*25 + 1*40 = 90, units = 3, distinct orders = 2
    expect(series[1]).toMatchObject({ revenue: 90, units: 3, orders: 2 });
    // 07-03's only item is unpaid — zero-filled, not counted
    expect(series[2]).toMatchObject({ revenue: 0, units: 0, orders: 0 });
  });

  it('200 zero-fills the full range with no products/items', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok([])); // no products at all
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-01', to: '2026-07-05' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.series).toHaveLength(5);
    expect(res.body.data.series.every((b: any) => b.revenue === 0 && b.units === 0 && b.orders === 0)).toBe(true);
  });

  it('400 when from > to', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-10', to: '2026-07-01' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(400);
  });

  it('400 when the range exceeds 366 days', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2020-01-01', to: '2026-07-01' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(400);
  });

  it('400 on an invalid interval', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-01', to: '2026-07-05', interval: 'year' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(400);
  });

  it('401 without a token', async () => {
    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-01', to: '2026-07-05' });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a seller', async () => {
    const client = nonSellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'user' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-01', to: '2026-07-05' })
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });

  it("seller isolation: another seller's paid items never enter the bucketed series", async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID }])) // ONLY this seller's product ids are ever queried against order_items
      .mockReturnValueOnce(
        ok([
          {
            order_id: ORDER_A,
            quantity: 1,
            price_at_purchase: 15,
            orders: { created_at: '2026-07-01T00:00:00Z', payment_status: 'paid' },
          },
        ]),
      );
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/sales')
      .query({ from: '2026-07-01', to: '2026-07-01' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.series[0]).toMatchObject({ revenue: 15, units: 1, orders: 1 });
  });
});

describe('/api/seller/reports/top-products', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('200 ranks by revenue desc, respects limit, paid-only', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(
        ok([
          { id: PRODUCT_ID, name: 'Widget' },
          { id: 'p-2', name: 'Gadget' },
        ]),
      ) // seller products
      .mockReturnValueOnce(
        ok([
          {
            product_id: PRODUCT_ID,
            quantity: 2,
            price_at_purchase: 50,
            orders: { created_at: '2026-07-02T00:00:00Z', payment_status: 'paid' },
          }, // Widget revenue 100
          {
            product_id: 'p-2',
            quantity: 10,
            price_at_purchase: 20,
            orders: { created_at: '2026-07-02T00:00:00Z', payment_status: 'paid' },
          }, // Gadget revenue 200
          {
            product_id: PRODUCT_ID,
            quantity: 100,
            price_at_purchase: 500,
            orders: { created_at: '2026-07-02T00:00:00Z', payment_status: 'pending' },
          }, // unpaid — excluded
        ]),
      );
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-01', to: '2026-07-03', limit: 1 })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0]).toMatchObject({ product_id: 'p-2', name: 'Gadget', units: 10, revenue: 200 });
  });

  it('200 empty products array when the seller has no products', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' })).mockReturnValueOnce(ok([]));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-01', to: '2026-07-03' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.products).toEqual([]);
  });

  it('400 when from > to', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-05', to: '2026-07-01' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(400);
  });

  it('400 when limit exceeds 20', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-01', to: '2026-07-03', limit: 50 })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(400);
  });

  it('401 without a token', async () => {
    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-01', to: '2026-07-03' });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a seller', async () => {
    const client = nonSellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'user' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-01', to: '2026-07-03' })
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });

  it("seller isolation: another seller's product ids are never included in the query and never ranked", async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID, name: 'Widget' }])) // scoped to seller_id — co-seller product absent
      .mockReturnValueOnce(
        ok([
          {
            product_id: PRODUCT_ID,
            quantity: 1,
            price_at_purchase: 30,
            orders: { created_at: '2026-07-02T00:00:00Z', payment_status: 'paid' },
          },
        ]),
      );
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .get('/api/seller/reports/top-products')
      .query({ from: '2026-07-01', to: '2026-07-03' })
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.products).toEqual([{ product_id: PRODUCT_ID, name: 'Widget', units: 1, revenue: 30 }]);
    expect(JSON.stringify(res.body)).not.toContain(OTHER_PRODUCT_ID);
  });
});
