import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const ORDER_ID = '99999999-9999-9999-9999-999999999999';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';

function sellerClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'seller-1', email: 's@b.com' });
  return client;
}

describe('/api/seller/orders', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  describe('PATCH /:id/status', () => {
    it('200 on a valid transition (paid → processing) and records an event', async () => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
        .mockReturnValueOnce(ok({ id: ORDER_ID, status: 'paid' })) // order load
        .mockReturnValueOnce(ok({ id: 'oi-1' })) // ownership
        .mockReturnValueOnce(ok(null)) // status update
        .mockReturnValueOnce(ok(null)); // order_events insert
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'processing', note: 'Packing now' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('processing');
      expect(res.body.data.orderId).toBe(ORDER_ID);
    });

    it('400 on an invalid transition (paid → delivered)', async () => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' }))
        .mockReturnValueOnce(ok({ id: ORDER_ID, status: 'paid' }))
        .mockReturnValueOnce(ok({ id: 'oi-1' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'delivered' });

      expect(res.status).toBe(400);
    });

    it('400 when a seller attempts a cancellation (paid → cancelled is admin-only)', async () => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' }))
        .mockReturnValueOnce(ok({ id: ORDER_ID, status: 'paid' }))
        .mockReturnValueOnce(ok({ id: 'oi-1' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'cancelled' });

      expect(res.status).toBe(400);
    });

    it('404 when the seller owns no product in the order', async () => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' }))
        .mockReturnValueOnce(ok({ id: ORDER_ID, status: 'paid' }))
        .mockReturnValueOnce(ok(null)); // ownership: none
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'processing' });

      expect(res.status).toBe(404);
    });

    it('403 when the caller is not a seller', async () => {
      const client = sellerClient();
      client.from.mockReturnValueOnce(ok({ role: 'user' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'processing' });

      expect(res.status).toBe(403);
    });

    it('401 without a token', async () => {
      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .send({ status: 'processing' });
      expect(res.status).toBe(401);
    });

    it('400 on a malformed order id', async () => {
      const client = sellerClient();
      client.from.mockReturnValueOnce(ok({ role: 'seller' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch('/api/seller/orders/not-a-uuid/status')
        .set('Authorization', 'Bearer t')
        .send({ status: 'processing' });

      expect(res.status).toBe(400);
    });

    it('400 on a status value outside the known enum', async () => {
      const client = sellerClient();
      client.from.mockReturnValueOnce(ok({ role: 'seller' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'in_orbit' });

      expect(res.status).toBe(400);
    });

    it.each([
      ['processing', 'shipped'],
      ['shipped', 'out_for_delivery'],
      ['out_for_delivery', 'delivered'],
    ])('200 on the valid adjacent transition %s → %s', async (from, to) => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' }))
        .mockReturnValueOnce(ok({ id: ORDER_ID, status: from }))
        .mockReturnValueOnce(ok({ id: 'oi-1' }))
        .mockReturnValueOnce(ok(null))
        .mockReturnValueOnce(ok(null));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: to });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(to);
    });

    it('400 when the order has already reached a terminal state (delivered → anything)', async () => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' }))
        .mockReturnValueOnce(ok({ id: ORDER_ID, status: 'delivered' }))
        .mockReturnValueOnce(ok({ id: 'oi-1' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .patch(`/api/seller/orders/${ORDER_ID}/status`)
        .set('Authorization', 'Bearer t')
        .send({ status: 'processing' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /', () => {
    it("200 returns ONLY the seller's items + a seller-scoped subtotal in a multi-seller order", async () => {
      const OTHER_PRODUCT_ID = '33333333-3333-3333-3333-333333333333';
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
        .mockReturnValueOnce(ok([{ id: PRODUCT_ID }])) // seller products
        .mockReturnValueOnce(ok([{ order_id: ORDER_ID }])) // order_items → order ids
        .mockReturnValueOnce(
          ok([
            {
              id: ORDER_ID,
              currency: 'INR',
              status: 'paid',
              payment_status: 'paid',
              created_at: '2026-07-10T00:00:00Z',
              // Shared order: one item belongs to this seller, one to another.
              order_items: [
                {
                  product_id: PRODUCT_ID,
                  quantity: 2,
                  price_at_purchase: 50,
                  product: { name: 'Widget', images: ['a.jpg'], seller_id: 'seller-1' },
                },
                {
                  product_id: OTHER_PRODUCT_ID,
                  quantity: 5,
                  price_at_purchase: 999,
                  product: { name: 'Rival Gizmo', images: ['b.jpg'], seller_id: 'seller-2' },
                },
              ],
            },
          ]),
        ) // orders embed
        .mockReturnValueOnce(
          ok([{ order_id: ORDER_ID, status: 'paid', note: 'Payment captured', created_at: '2026-07-10T00:01:00Z' }]),
        ); // events
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app).get('/api/seller/orders').set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toHaveLength(1);
      const order = res.body.data.orders[0];
      // Only this seller's single item — the co-seller's item is not exposed.
      expect(order.items).toHaveLength(1);
      expect(order.items[0].product.name).toBe('Widget');
      // Co-seller's product data must never leak, incl. seller_id.
      expect(JSON.stringify(order)).not.toContain('Rival Gizmo');
      expect(JSON.stringify(order)).not.toContain('seller_id');
      // Money figure is the seller subtotal (50 * 2 = 100), not the full order.
      expect(order.seller_subtotal).toBe(100);
      expect(order.amount).toBe(100);
      expect(order.events).toHaveLength(1);
    });

    it('200 returns an empty list when the seller has no products yet', async () => {
      const client = sellerClient();
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' }))
        .mockReturnValueOnce(ok([])); // no products
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app).get('/api/seller/orders').set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toEqual([]);
    });

    it('401 without a token', async () => {
      const res = await request(app).get('/api/seller/orders');
      expect(res.status).toBe(401);
    });
  });
});
