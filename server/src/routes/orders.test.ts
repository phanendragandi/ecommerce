import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

process.env.RAZORPAY_KEY_ID = 'rzp_test_key';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

// Razorpay client is mocked wholesale — no real orders.create call.
const { rzpCreate } = vi.hoisted(() => ({ rzpCreate: vi.fn() }));
vi.mock('../lib/razorpay.js', () => ({
  razorpay: () => ({ orders: { create: rzpCreate } }),
}));

const ADDRESS_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = '99999999-9999-9999-9999-999999999999';

function authedClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'user-1', email: 'a@b.com' });
  return client;
}

describe('/api/orders', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
    rzpCreate.mockReset();
  });

  describe('POST /checkout', () => {
    it('201 creates a pending order and Razorpay order', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ADDRESS_ID })) // address ownership
        .mockReturnValueOnce(
          ok([{ id: PRODUCT_ID, name: 'Widget', price: 100, offer_price: 50, stock: 10 }]),
        ) // products
        .mockReturnValueOnce(ok({ id: ORDER_ID })) // orders insert
        .mockReturnValueOnce(ok(null)) // order_items insert
        .mockReturnValueOnce(ok(null)) // order_events insert
        .mockReturnValueOnce(ok(null)); // orders update razorpay_order_id
      rzpCreate.mockResolvedValue({ id: 'rzp_order_1' });
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 2 }] });

      expect(res.status).toBe(201);
      expect(res.body.data.orderId).toBe(ORDER_ID);
      expect(res.body.data.rzpOrderId).toBe('rzp_order_1');
      // offer_price 50 * 2 = 100 rupees = 10000 paise
      expect(res.body.data.amount).toBe(10000);
      expect(res.body.data.currency).toBe('INR');
      expect(res.body.data.keyId).toBe('rzp_test_key');
      // Razorpay always receives the server-computed paise amount.
      expect(rzpCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 10000, currency: 'INR', receipt: ORDER_ID }),
      );
    });

    it('computes the amount from DB price, ignoring any client-supplied price', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ADDRESS_ID }))
        .mockReturnValueOnce(
          ok([{ id: PRODUCT_ID, name: 'Widget', price: 100, offer_price: 50, stock: 10 }]),
        )
        .mockReturnValueOnce(ok({ id: ORDER_ID }))
        .mockReturnValueOnce(ok(null))
        .mockReturnValueOnce(ok(null))
        .mockReturnValueOnce(ok(null));
      rzpCreate.mockResolvedValue({ id: 'rzp_order_1' });
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({
          address_id: ADDRESS_ID,
          // Malicious client price fields — must be stripped/ignored.
          amount: 1,
          items: [{ product_id: PRODUCT_ID, quantity: 2, price: 1, price_at_purchase: 1 }],
        });

      expect(res.status).toBe(201);
      // Still 50 * 2 * 100 = 10000 paise from the DB, not the client's 1.
      expect(res.body.data.amount).toBe(10000);
    });

    it('401 without a token', async () => {
      const res = await request(app)
        .post('/api/orders/checkout')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 1 }] });
      expect(res.status).toBe(401);
    });

    it('400 on invalid body (empty items)', async () => {
      const client = authedClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [] });

      expect(res.status).toBe(400);
    });

    it('400 on insufficient stock', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ADDRESS_ID }))
        .mockReturnValueOnce(
          ok([{ id: PRODUCT_ID, name: 'Widget', price: 100, offer_price: 50, stock: 1 }]),
        );
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 3 }] });

      expect(res.status).toBe(400);
      expect(rzpCreate).not.toHaveBeenCalled();
    });

    it('404 when the address belongs to another user (IDOR attempt)', async () => {
      const client = authedClient();
      // The query is scoped by .eq('user_id', callerId); an address owned by
      // someone else never matches, so the mock returns no row.
      client.from.mockReturnValueOnce(ok(null));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 1 }] });

      expect(res.status).toBe(404);
      expect(rzpCreate).not.toHaveBeenCalled();
    });

    it('400 when a cart item references a product that went inactive between cart and checkout', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ADDRESS_ID })) // address ownership
        // The products query filters `.eq('is_active', true)`, so a
        // deactivated product simply never comes back.
        .mockReturnValueOnce(ok([]));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/unavailable/i);
      expect(rzpCreate).not.toHaveBeenCalled();
    });

    it('400 when the computed order total is zero (e.g. a zero-priced product row)', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ADDRESS_ID }))
        .mockReturnValueOnce(
          ok([{ id: PRODUCT_ID, name: 'Freebie', price: 0, offer_price: null, stock: 10 }]),
        );
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 2 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/greater than zero/i);
      expect(rzpCreate).not.toHaveBeenCalled();
    });

    it('400 on a malformed uuid in address_id', async () => {
      const client = authedClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: 'not-a-uuid', items: [{ product_id: PRODUCT_ID, quantity: 1 }] });

      expect(res.status).toBe(400);
    });

    it('400 on a malformed uuid in items[].product_id', async () => {
      const client = authedClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: 'not-a-uuid', quantity: 1 }] });

      expect(res.status).toBe(400);
    });

    it('400 on a zero quantity line item', async () => {
      const client = authedClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/orders/checkout')
        .set('Authorization', 'Bearer t')
        .send({ address_id: ADDRESS_ID, items: [{ product_id: PRODUCT_ID, quantity: 0 }] });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /', () => {
    it('200 returns orders with items and events in the pinned shape', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(
          ok([
            {
              id: ORDER_ID,
              amount: 100,
              currency: 'INR',
              status: 'paid',
              payment_status: 'paid',
              created_at: '2026-07-10T00:00:00Z',
              order_items: [
                {
                  product_id: PRODUCT_ID,
                  quantity: 2,
                  price_at_purchase: 50,
                  product: { name: 'Widget', images: ['a.jpg'] },
                },
              ],
            },
          ]),
        ) // orders + embed
        .mockReturnValueOnce(
          ok([
            { order_id: ORDER_ID, status: 'pending', note: 'Order created', created_at: '2026-07-10T00:00:00Z' },
            { order_id: ORDER_ID, status: 'paid', note: 'Payment captured', created_at: '2026-07-10T00:01:00Z' },
          ]),
        ); // events
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app).get('/api/orders').set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toHaveLength(1);
      const order = res.body.data.orders[0];
      expect(order.items[0].product.name).toBe('Widget');
      expect(order.items[0].price_at_purchase).toBe(50);
      expect(order.events).toHaveLength(2);
      expect(order.events[1].status).toBe('paid');
    });

    it('200 returns an empty list when the caller has no orders', async () => {
      const client = authedClient();
      client.from.mockReturnValueOnce(ok([]));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app).get('/api/orders').set('Authorization', 'Bearer t');

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toEqual([]);
    });

    it('401 without a token', async () => {
      const res = await request(app).get('/api/orders');
      expect(res.status).toBe(401);
    });
  });
});
