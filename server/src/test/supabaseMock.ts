import { vi, type Mock } from 'vitest';

/**
 * Shared Supabase mocking helpers for route tests. There is no live
 * database in this environment — every test mocks `supabaseAdmin()` and
 * exercises the route handler's logic against a fake, chainable query
 * builder that mimics the shape of supabase-js's PostgrestFilterBuilder
 * (itself a thenable).
 */

export interface MockResult {
  data: unknown;
  error: { message: string } | null;
  count?: number;
}

type ResultSource = MockResult | (() => MockResult);

export class QueryBuilder implements PromiseLike<MockResult> {
  public readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(private readonly result: ResultSource) {}

  private chain(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]): this {
    return this.chain('select', args);
  }
  insert(...args: unknown[]): this {
    return this.chain('insert', args);
  }
  update(...args: unknown[]): this {
    return this.chain('update', args);
  }
  delete(...args: unknown[]): this {
    return this.chain('delete', args);
  }
  eq(...args: unknown[]): this {
    return this.chain('eq', args);
  }
  neq(...args: unknown[]): this {
    return this.chain('neq', args);
  }
  ilike(...args: unknown[]): this {
    return this.chain('ilike', args);
  }
  order(...args: unknown[]): this {
    return this.chain('order', args);
  }
  range(...args: unknown[]): this {
    return this.chain('range', args);
  }
  single(): this {
    return this.chain('single', []);
  }
  maybeSingle(): this {
    return this.chain('maybeSingle', []);
  }

  then<TResult1 = MockResult, TResult2 = never>(
    onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const value = typeof this.result === 'function' ? this.result() : this.result;
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

/** A successful query builder result. */
export function ok(data: unknown, count?: number): QueryBuilder {
  return new QueryBuilder(count === undefined ? { data, error: null } : { data, error: null, count });
}

/** A failed query builder result. */
export function fail(message: string): QueryBuilder {
  return new QueryBuilder({ data: null, error: { message } });
}

export interface MockStorageBucket {
  upload: Mock;
  getPublicUrl: Mock;
}

export function createStorageBucketMock(overrides?: Partial<MockStorageBucket>): MockStorageBucket {
  return {
    upload: overrides?.upload ?? vi.fn().mockResolvedValue({ data: { path: 'mock' }, error: null }),
    getPublicUrl:
      overrides?.getPublicUrl ??
      vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.example.com/mock.jpg' } }),
  };
}

export interface MockSupabaseClient {
  from: Mock;
  auth: { getUser: Mock };
  storage: { from: Mock };
}

/** A fresh, unconfigured mock Supabase client. Configure `.from`/`.auth`/`.storage` per test. */
export function createMockClient(): MockSupabaseClient {
  return {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    storage: { from: vi.fn(() => createStorageBucketMock()) },
  };
}

/** Convenience: configure auth.getUser to resolve to a given user (or an error if null). */
export function mockAuthenticatedUser(
  client: MockSupabaseClient,
  user: { id: string; email?: string } | null,
): void {
  if (user) {
    client.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  } else {
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });
  }
}
