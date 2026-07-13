// Shared API helpers for e2e setup/teardown — talk to the Express API as the
// demo seller using a Supabase password-grant token.
const API = 'http://localhost:4000';

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function getSellerToken(ctx) {
  const auth = await ctx.post(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      data: {
        email: process.env.E2E_SELLER_EMAIL,
        password: process.env.E2E_SELLER_PASSWORD,
      },
    }
  );
  const body = await auth.json();
  if (!body.access_token) throw new Error(`seller token request failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

// Delete every product whose name matches `pattern` (default: all e2e-created
// products, fixtures and per-test ones alike).
async function sweepE2EProducts(ctx, token, pattern = /^E2E /) {
  const headers = { Authorization: `Bearer ${token}` };
  const res = await ctx.get(`${API}/api/seller/products`, { headers });
  const products = (await res.json())?.data?.products ?? [];
  for (const p of products.filter((p) => pattern.test(p.name))) {
    await ctx.delete(`${API}/api/seller/products/${p.id}`, { headers });
  }
}

async function createProductWithImage(ctx, token, product) {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await ctx.post(`${API}/api/seller/products`, { headers, data: product });
  const body = await created.json();
  if (!body?.data?.product?.id) throw new Error(`product create failed: ${JSON.stringify(body)}`);
  const id = body.data.product.id;
  const upload = await ctx.post(`${API}/api/seller/products/${id}/images`, {
    headers,
    multipart: {
      images: { name: 'fixture.png', mimeType: 'image/png', buffer: TINY_PNG },
    },
  });
  if (!upload.ok()) throw new Error(`image upload failed: ${upload.status()}`);
  return id;
}

// Catalog fixtures the storefront/cart specs rely on. The store no longer
// ships seed data, so the suite provisions (and removes) its own.
const FIXTURE_PRODUCTS = [
  {
    name: 'E2E Fixture Headphones',
    description: 'Catalog fixture created by the Playwright suite.',
    category: 'Headphone',
    price: 100,
    offer_price: 90,
    stock: 10,
  },
  {
    name: 'E2E Fixture Speaker',
    description: 'Catalog fixture created by the Playwright suite.',
    category: 'Accessories',
    price: 50,
    offer_price: 40,
    stock: 10,
  },
];

module.exports = { API, TINY_PNG, getSellerToken, sweepE2EProducts, createProductWithImage, FIXTURE_PRODUCTS };
