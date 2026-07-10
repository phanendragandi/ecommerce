import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { supabaseAdmin } from './lib/supabaseAdmin.js';
import { createMockClient, mockAuthenticatedUser, ok } from './test/supabaseMock.js';

/**
 * Cross-cutting regression tests that don't belong to a single route file:
 * body-size limits, malformed request bodies, and other app-level edges
 * called out in the Phase 5 QA gap analysis.
 */

vi.mock('./lib/supabaseAdmin.js', () => ({ supabaseAdmin: vi.fn() }));
const mockedSupabaseAdmin = vi.mocked(supabaseAdmin);

function authedClient() {
  const client = createMockClient();
  mockAuthenticatedUser(client, { id: 'user-1', email: 'a@b.com' });
  return client;
}

describe('regression: oversized payloads (CLAUDE.md 1mb body limit)', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  // CLAUDE.md's security rules call for a 1mb body limit, and
  // express.json({ limit: '1mb' }) IS enforcing it (the handler never runs
  // — client.from is never called below). body-parser's PayloadTooLargeError
  // carries `.status = 413`; errorHandler.ts now honors that status (via its
  // safe-status allowlist) instead of falling back to a generic 500, so
  // callers can correctly branch on 4xx vs 5xx.
  it('a >1mb JSON body is rejected before reaching the route handler with 413', async () => {
    const client = authedClient();
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const bigString = 'x'.repeat(2 * 1024 * 1024); // 2MB, well past the 1mb limit
    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', 'Bearer t')
      .send({
        full_name: bigString,
        phone: '9876543210',
        pincode: '560001',
        area: 'a',
        city: 'b',
        state: 'c',
      });

    // The oversized body must never reach the handler / touch the DB.
    expect(client.from).not.toHaveBeenCalled();
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'Payload too large' });
  });
});

describe('regression: malformed JSON bodies on ordinary (non-webhook) routes', () => {
  const app = createApp();

  beforeEach(() => {
    mockedSupabaseAdmin.mockReset();
  });

  // Same root cause as the oversized-payload case above: body-parser's JSON
  // SyntaxError carries `.status = 400` / `.statusCode = 400`. errorHandler.ts
  // now honors that upstream status (via its safe-status allowlist) instead
  // of discarding it in favor of a hardcoded 500 — a malformed body is a
  // client error (400), not a server error (500).
  it('malformed JSON body returns 400', async () => {
    const client = authedClient();
    mockedSupabaseAdmin.mockReturnValue(client as any);

    const res = await request(app)
      .post('/api/addresses')
      .set('Authorization', 'Bearer t')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(client.from).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Malformed request body' });
  });
});
