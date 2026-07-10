import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';

function authedClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'user-1', email: 'a@b.com' });
  return client;
}

describe('/api/cart', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('GET 200 returns the caller cart', async () => {
    const client = authedClient();
    client.from.mockReturnValue(ok([{ product_id: PRODUCT_ID, quantity: 2, user_id: 'user-1' }]));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/cart').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  it('GET 401 without a token', async () => {
    const res = await request(app).get('/api/cart');
    expect(res.status).toBe(401);
  });

  it('PUT 200 replaces the cart', async () => {
    const client = authedClient();
    client.from
      .mockReturnValueOnce(ok(null)) // delete existing rows
      .mockReturnValueOnce(ok([{ product_id: PRODUCT_ID, quantity: 3, user_id: 'user-1' }])); // insert new rows
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .put('/api/cart')
      .set('Authorization', 'Bearer t')
      .send({ items: [{ product_id: PRODUCT_ID, quantity: 3 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].quantity).toBe(3);
  });

  it('PUT 400 on duplicate product_id', async () => {
    const client = authedClient();
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .put('/api/cart')
      .set('Authorization', 'Bearer t')
      .send({
        items: [
          { product_id: PRODUCT_ID, quantity: 1 },
          { product_id: PRODUCT_ID, quantity: 2 },
        ],
      });

    expect(res.status).toBe(400);
  });

  it('PUT 401 without a token', async () => {
    const res = await request(app).put('/api/cart').send({ items: [] });
    expect(res.status).toBe(401);
  });
});
