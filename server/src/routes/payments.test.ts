import crypto from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { QueryBuilder, createMockClient, fail, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const ORDER_ID = '99999999-9999-9999-9999-999999999999';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const RZP_ORDER_ID = 'order_rzp_1';
const RZP_PAYMENT_ID = 'pay_rzp_1';

function authedClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'user-1', email: 'a@b.com' });
  return client;
}

function verifySignature(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

function webhookSignature(raw: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
}

describe('/api/payments', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  describe('POST /verify', () => {
    it('200 captures on a valid signature and decrements stock once', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ORDER_ID, user_id: 'user-1', status: 'pending', payment_status: 'pending' })) // load
        .mockReturnValueOnce(ok({ id: ORDER_ID })) // CAS update won
        .mockReturnValueOnce(ok([{ product_id: PRODUCT_ID, quantity: 2 }])) // items
        .mockReturnValueOnce(ok(null)) // order_events insert
        .mockReturnValueOnce(ok(null)); // cart clear
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', 'Bearer t')
        .send({
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: verifySignature(RZP_ORDER_ID, RZP_PAYMENT_ID),
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.orderId).toBe(ORDER_ID);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith('decrement_stock', {
        p_product_id: PRODUCT_ID,
        p_quantity: 2,
      });
    });

    it('400 on a tampered signature and never mutates', async () => {
      const client = authedClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', 'Bearer t')
        .send({
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: 'deadbeef',
        });

      expect(res.status).toBe(400);
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('200 idempotent replay: an already-paid order is not re-decremented', async () => {
      const client = authedClient();
      // Order already captured.
      client.from.mockReturnValueOnce(
        ok({ id: ORDER_ID, user_id: 'user-1', status: 'paid', payment_status: 'paid' }),
      );
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', 'Bearer t')
        .send({
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: verifySignature(RZP_ORDER_ID, RZP_PAYMENT_ID),
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('CAS race: two captures that BOTH pass the read guard decrement stock once', async () => {
      const client = authedClient();
      let claimed = false;

      // Simulate the TOCTOU race: both concurrent reads still observe
      // `pending` (neither write has landed yet), but the compare-and-swap
      // update claims a row only for the first caller — the second gets null.
      client.from.mockImplementation((table: string) => {
        if (table === 'orders') {
          const qb: QueryBuilder = new QueryBuilder(() => {
            const isUpdate = qb.calls.some((c) => c.method === 'update');
            if (isUpdate) {
              if (!claimed) {
                claimed = true;
                return { data: { id: ORDER_ID }, error: null };
              }
              return { data: null, error: null };
            }
            // Read guard: both callers see pending.
            return {
              data: { id: ORDER_ID, user_id: 'user-1', status: 'pending', payment_status: 'pending' },
              error: null,
            };
          });
          return qb;
        }
        if (table === 'order_items') {
          return ok([{ product_id: PRODUCT_ID, quantity: 2 }]);
        }
        return ok(null); // order_events, cart_items
      });
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const body = {
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: verifySignature(RZP_ORDER_ID, RZP_PAYMENT_ID),
      };
      const first = await request(app).post('/api/payments/verify').set('Authorization', 'Bearer t').send(body);
      const second = await request(app).post('/api/payments/verify').set('Authorization', 'Bearer t').send(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // Only the CAS winner decrements — the loser bails without touching stock.
      expect(client.rpc).toHaveBeenCalledTimes(1);
    });

    it('401 without a token', async () => {
      const res = await request(app)
        .post('/api/payments/verify')
        .send({
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: verifySignature(RZP_ORDER_ID, RZP_PAYMENT_ID),
        });
      expect(res.status).toBe(401);
    });

    it('400 on a missing field (zod)', async () => {
      const client = authedClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', 'Bearer t')
        .send({ razorpay_order_id: RZP_ORDER_ID, razorpay_payment_id: RZP_PAYMENT_ID });

      expect(res.status).toBe(400);
    });

    it('404 when no order matches this Razorpay order id for the caller', async () => {
      const client = authedClient();
      client.from.mockReturnValueOnce(ok(null)); // owner-scoped load finds nothing
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', 'Bearer t')
        .send({
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: verifySignature(RZP_ORDER_ID, RZP_PAYMENT_ID),
        });

      expect(res.status).toBe(404);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('order still ends up paid (flagged for manual review) when the stock RPC fails post-charge', async () => {
      const client = authedClient();
      client.from
        .mockReturnValueOnce(ok({ id: ORDER_ID, user_id: 'user-1', status: 'pending', payment_status: 'pending' })) // load
        .mockReturnValueOnce(ok({ id: ORDER_ID })) // CAS update won
        .mockReturnValueOnce(ok([{ product_id: PRODUCT_ID, quantity: 2 }])) // items
        .mockReturnValueOnce(ok(null)) // order_events insert
        .mockReturnValueOnce(ok(null)); // cart clear
      client.rpc.mockResolvedValue({ data: null, error: { message: 'insufficient stock' } });
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', 'Bearer t')
        .send({
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: verifySignature(RZP_ORDER_ID, RZP_PAYMENT_ID),
        });

      // The buyer was already charged — the order must still be reported as
      // paid even though the stock decrement failed (never silently revert
      // a successful charge).
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      const eventsInsertCall = (client.from.mock.results[3].value as {
        calls: Array<{ method: string; args: unknown[] }>;
      }).calls.find((c) => c.method === 'insert');
      const eventRow = eventsInsertCall?.args[0] as { note?: string };
      expect(eventRow.note).toMatch(/manual review/i);
    });
  });

  describe('POST /webhook', () => {
    function capturePayload(): string {
      return JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: RZP_PAYMENT_ID, order_id: RZP_ORDER_ID } } },
      });
    }

    it('200 captures payment.captured on a valid signature', async () => {
      const client = createMockClient();
      client.from
        .mockReturnValueOnce(ok({ id: ORDER_ID, user_id: 'user-1', status: 'pending', payment_status: 'pending' })) // load
        .mockReturnValueOnce(ok({ id: ORDER_ID })) // CAS update won
        .mockReturnValueOnce(ok([{ product_id: PRODUCT_ID, quantity: 2 }])) // items
        .mockReturnValueOnce(ok(null)) // order_events
        .mockReturnValueOnce(ok(null)); // cart clear
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = capturePayload();
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', webhookSignature(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledTimes(1);
    });

    it('400 on an invalid webhook signature and never processes', async () => {
      const client = createMockClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = capturePayload();
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', 'not-a-valid-signature')
        .send(raw);

      expect(res.status).toBe(400);
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('replay: the same payment.captured twice decrements stock exactly once', async () => {
      const client = createMockClient();
      let paid = false;

      // Stateful `orders` builder: a load reflects the current paid flag; an
      // update flips it. `order_items`/`order_events`/`cart_items` are static.
      client.from.mockImplementation((table: string) => {
        if (table === 'orders') {
          const qb: QueryBuilder = new QueryBuilder(() => {
            const isUpdate = qb.calls.some((c) => c.method === 'update');
            if (isUpdate) {
              // CAS: the update only claims a row while the order is unpaid.
              if (!paid) {
                paid = true;
                return { data: { id: ORDER_ID }, error: null };
              }
              return { data: null, error: null };
            }
            return {
              data: {
                id: ORDER_ID,
                user_id: 'user-1',
                status: paid ? 'paid' : 'pending',
                payment_status: paid ? 'paid' : 'pending',
              },
              error: null,
            };
          });
          return qb;
        }
        if (table === 'order_items') {
          return ok([{ product_id: PRODUCT_ID, quantity: 2 }]);
        }
        return ok(null); // order_events, cart_items
      });
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = capturePayload();
      const sig = webhookSignature(raw);

      const first = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(raw);
      const second = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(raw);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // Exactly one decrement across both deliveries.
      expect(client.rpc).toHaveBeenCalledTimes(1);
    });

    it('200 marks payment.failed without touching stock', async () => {
      const client = createMockClient();
      client.from
        .mockReturnValueOnce(ok({ id: ORDER_ID, payment_status: 'pending' })) // load
        .mockReturnValueOnce(ok(null)) // update failed
        .mockReturnValueOnce(ok(null)); // order_events insert
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = JSON.stringify({
        event: 'payment.failed',
        payload: { payment: { entity: { id: RZP_PAYMENT_ID, order_id: RZP_ORDER_ID } } },
      });
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', webhookSignature(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('500 on a transient processing error so Razorpay retries', async () => {
      const client = createMockClient();
      // Order load fails before any claim/mutation — capturePayment throws.
      client.from.mockReturnValueOnce(fail('db unavailable'));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = capturePayload();
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', webhookSignature(raw))
        .send(raw);

      expect(res.status).toBe(500);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('400 on a validly-signed but malformed JSON body', async () => {
      const client = createMockClient();
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = '{not valid json';
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', webhookSignature(raw))
        .send(raw);

      expect(res.status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    // A valid signature over an order_id that never resolves to a DB row is
    // TERMINAL (our orders row is created before the Razorpay order, so there
    // is no arrival race). capturePayment's 404 is acknowledged with 200 so
    // Razorpay stops retrying — no retry storm — and nothing is mutated.
    it('acknowledges an unknown order with 200 (terminal, no retry) and no mutation', async () => {
      const client = createMockClient();
      client.from.mockReturnValueOnce(ok(null)); // order lookup: no match
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const raw = capturePayload();
      const res = await request(app)
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', webhookSignature(raw))
        .send(raw);

      expect(res.status).toBe(200);
      expect(client.rpc).not.toHaveBeenCalled();
    });
  });
});
