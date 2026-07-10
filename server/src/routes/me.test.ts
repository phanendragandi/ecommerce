import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from '../test/supabaseMock.js';

vi.mock('../lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

describe('GET /api/me', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  it('200 returns the caller profile', async () => {
    const client = createMockClient();
    mockAuthenticatedUser(client, { id: 'user-1', email: 'a@b.com' });
    client.from.mockReturnValue(ok({ id: 'user-1', name: 'Ann', role: 'user' }));
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/me').set('Authorization', 'Bearer token123');

    expect(res.status).toBe(200);
    expect(res.body.data.profile.id).toBe('user-1');
  });

  it('401 without a token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('401 with an invalid token', async () => {
    const client = createMockClient();
    mockAuthenticatedUser(client, null);
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app).get('/api/me').set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
  });
});
