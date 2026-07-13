const { test, expect } = require('@playwright/test');

// Provisioned by catalog.setup.js — the store ships no seed data.
const FIXTURE_A = 'E2E Fixture Headphones';
const FIXTURE_B = 'E2E Fixture Speaker';

test.describe('storefront (guest)', () => {
  test('API serves the product catalog', async ({ request }) => {
    const res = await request.get('http://localhost:4000/api/products?limit=100');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.products.length).toBeGreaterThanOrEqual(2);
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
    await expect(page.getByText(FIXTURE_A).first()).toBeVisible();

    const failedApiCalls = consoleErrors.filter((t) => t.includes('Failed to load resource'));
    expect(failedApiCalls, `console errors: ${failedApiCalls.join(' | ')}`).toHaveLength(0);
  });

  test('all-products lists the catalog', async ({ page }) => {
    await page.goto('/all-products');
    await expect(page.getByText(FIXTURE_A).first()).toBeVisible();
    await expect(page.getByText(FIXTURE_B).first()).toBeVisible();
  });

  test('product detail page shows info and purchase CTAs', async ({ page }) => {
    await page.goto('/all-products');
    await page.getByText(FIXTURE_A).first().click();
    await page.waitForURL(/\/product\//);
    // .first() — the featured-products strip at the bottom repeats these labels.
    await expect(page.getByRole('button', { name: 'Add to Cart' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy now' }).first()).toBeVisible();
  });
});
