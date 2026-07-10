import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

const ADDRESS_ID = '22222222-2222-2222-2222-222222222222';

function authedClient(userId = 'user-1') {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: userId, email: 'a@b.com' });
  return client;
}

const validAddress = {
  full_name: 'Ann Lee',
  phone: '9876543210',
  pincode: '560001',
  area: 'MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
};

describe('/api/addresses', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('GET 200 lists the caller own addresses', async () => {
    const client = authedClient();
    client.from.mockReturnValue(ok([{ id: ADDRESS_ID, user_id: 'user-1', ...validAddress }]));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/addresses').set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body.data.addresses).toHaveLength(1);
  });

  it('GET 401 without a token', async () => {
    const res = await request(app).get('/api/addresses');
    expect(res.status).toBe(401);
  });

  it('POST 201 creates an address for the caller', async () => {
    const client = authedClient();
    client.from.mockReturnValue(ok({ id: ADDRESS_ID, user_id: 'user-1', ...validAddress }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).post('/api/addresses').set('Authorization', 'Bearer t').send(validAddress);

    expect(res.status).toBe(201);
    expect(res.body.data.address.id).toBe(ADDRESS_ID);
  });

  it('POST 400 on invalid phone number', async () => {
    const client = authedClient();
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', 'Bearer t')
      .send({ ...validAddress, phone: '123' });

    expect(res.status).toBe(400);
  });

  it('DELETE 200 removes an owned address', async () => {
    const client = authedClient();
    client.from.mockReturnValue(ok({ id: ADDRESS_ID, user_id: 'user-1', ...validAddress }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).delete(`/api/addresses/${ADDRESS_ID}`).set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
  });

  it('DELETE 404 when the address is not found/owned', async () => {
    const client = authedClient();
    client.from.mockReturnValue(ok(null));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).delete(`/api/addresses/${ADDRESS_ID}`).set('Authorization', 'Bearer t');

    expect(res.status).toBe(404);
  });
});
