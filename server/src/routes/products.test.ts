import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/products', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('200 returns active products', async () => {
    const client = createMockClient();
    client.from.mockReturnValue(ok([{ id: PRODUCT_ID, name: 'Widget', is_active: true }], 1));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(client.from).toHaveBeenCalledWith('products');
  });

  it('400 on invalid query (limit out of range)', async () => {
    const res = await request(app).get('/api/products').query({ limit: '0' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/products/:id', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('200 returns the active product', async () => {
    const client = createMockClient();
    client.from.mockReturnValue(ok({ id: PRODUCT_ID, name: 'Widget', is_active: true }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get(`/api/products/${PRODUCT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.product.id).toBe(PRODUCT_ID);
  });

  it('404 when product is missing or inactive', async () => {
    const client = createMockClient();
    client.from.mockReturnValue(ok(null));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get(`/api/products/${PRODUCT_ID}`);
    expect(res.status).toBe(404);
  });

  it('400 on invalid uuid', async () => {
    const res = await request(app).get('/api/products/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
