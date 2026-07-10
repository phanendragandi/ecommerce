import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, createStorageBucketMock, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const PRODUCT_ID = '44444444-4444-4444-4444-444444444444';

function sellerClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'seller-1', email: 's@b.com' });
  return client;
}

const validProduct = {
  name: 'Widget',
  description: 'A fine widget',
  category: 'gadgets',
  price: 100,
  stock: 5,
};

describe('/api/seller/products', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('GET 200 lists the seller own products', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
      .mockReturnValueOnce(ok([{ id: PRODUCT_ID, seller_id: 'seller-1' }])); // list
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/products').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.products).toHaveLength(1);
  });

  it('401 without a token', async () => {
    const res = await request(app).get('/api/seller/products');
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a seller', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'user' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/seller/products').set('Authorization', 'Bearer t');
    expect(res.status).toBe(403);
  });

  it('POST 201 creates a product', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok({ id: PRODUCT_ID, seller_id: 'seller-1', ...validProduct }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .post('/api/seller/products')
      .set('Authorization', 'Bearer t')
      .send(validProduct);

    expect(res.status).toBe(201);
    expect(res.body.data.product.id).toBe(PRODUCT_ID);
  });

  it('POST 400 when offer_price exceeds price', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .post('/api/seller/products')
      .set('Authorization', 'Bearer t')
      .send({ ...validProduct, offer_price: 200 });

    expect(res.status).toBe(400);
  });

  it('PATCH 200 updates an owned product', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok({ id: PRODUCT_ID, seller_id: 'seller-1', stock: 9 }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .patch(`/api/seller/products/${PRODUCT_ID}`)
      .set('Authorization', 'Bearer t')
      .send({ stock: 9 });

    expect(res.status).toBe(200);
    expect(res.body.data.product.stock).toBe(9);
  });

  it('PATCH 404 when the product is not owned/found', async () => {
    const client = sellerClient();
    client.from.mockReturnValueOnce(ok({ role: 'seller' })).mockReturnValueOnce(ok(null));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .patch(`/api/seller/products/${PRODUCT_ID}`)
      .set('Authorization', 'Bearer t')
      .send({ stock: 9 });

    expect(res.status).toBe(404);
  });

  it('DELETE 200 soft-deletes an owned product', async () => {
    const client = sellerClient();
    client.from
      .mockReturnValueOnce(ok({ role: 'seller' }))
      .mockReturnValueOnce(ok({ id: PRODUCT_ID, seller_id: 'seller-1', is_active: false }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .delete(`/api/seller/products/${PRODUCT_ID}`)
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.product.is_active).toBe(false);
  });

  describe('POST /:id/images', () => {
    it('201 uploads images to the seller path and updates the product', async () => {
      const client = sellerClient();
      const bucket = createStorageBucketMock();
      client.storage.from.mockReturnValue(bucket);
      client.from
        .mockReturnValueOnce(ok({ role: 'seller' })) // requireSeller
        .mockReturnValueOnce(ok({ id: PRODUCT_ID, images: [] })) // ownership fetch
        .mockReturnValueOnce(
          ok({ id: PRODUCT_ID, images: ['https://storage.example.com/mock.jpg'] }),
        ); // update
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post(`/api/seller/products/${PRODUCT_ID}/images`)
        .set('Authorization', 'Bearer t')
        .attach('images', Buffer.from('fake-image-bytes'), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(201);
      expect(bucket.upload).toHaveBeenCalledTimes(1);
      const uploadKey = bucket.upload.mock.calls[0]?.[0] as string;
      expect(uploadKey.startsWith('seller-1/')).toBe(true);
      expect(res.body.data.product.images).toEqual(['https://storage.example.com/mock.jpg']);
    });

    it('400 rejects a disallowed mime type', async () => {
      const client = sellerClient();
      client.from.mockReturnValueOnce(ok({ role: 'seller' }));
      mockedSupabaseAdmin.mockReturnValue(client as any);

      const res = await request(app)
        .post(`/api/seller/products/${PRODUCT_ID}/images`)
        .set('Authorization', 'Bearer t')
        .attach('images', Buffer.from('not-an-image'), {
          filename: 'a.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(400);
    });

    it('401 without a token', async () => {
      const res = await request(app)
        .post(`/api/seller/products/${PRODUCT_ID}/images`)
        .attach('images', Buffer.from('fake-image-bytes'), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(401);
    });
  });
});
