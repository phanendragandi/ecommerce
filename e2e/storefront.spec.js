const { test, expect } = require('@playwright/test');

const SEED_PRODUCT = 'Apple AirPods Pro 2nd gen';

test.describe('storefront (guest)', () => {
  test('API serves the product catalog', async ({ request }) => {
    const res = await request.get('http://localhost:4000/api/products?limit=100');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.products.length).toBeGreaterThanOrEqual(10);
    for (const p of body.data.products) {
      expect(p.images.length, `product "${p.name}" has no images`).toBeGreaterThan(0);
    }
  });

  test('home page renders the live catalog', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByText(SEED_PRODUCT).first()).toBeVisible();

    const failedApiCalls = consoleErrors.filter((t) => t.includes('Failed to load resource'));
    expect(failedApiCalls, `console errors: ${failedApiCalls.join(' | ')}`).toHaveLength(0);
  });

  test('all-products lists the full catalog', async ({ page }) => {
    await page.goto('/all-products');
    await expect(page.getByText(SEED_PRODUCT).first()).toBeVisible();
    await expect(page.getByText('PlayStation 5').first()).toBeVisible();
    await expect(page.getByText('MacBook Pro 16').first()).toBeVisible();
  });

  test('product detail page shows info and purchase CTAs', async ({ page }) => {
    await page.goto('/all-products');
    await page.getByText(SEED_PRODUCT).first().click();
    await page.waitForURL(/\/product\//);
    // .first() — the featured-products strip at the bottom repeats these labels.
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy now' }).first()).toBeVisible();
  });
});
