const { test, expect } = require('@playwright/test');

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('seller (logged in)', () => {
  test('dashboard renders stats', async ({ page }) => {
    await page.goto('/seller');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Revenue', { exact: true })).toBeVisible();
  });

  test('add product with image, verify on store, then delete', async ({ page }) => {
    const name = `E2E Test Product ${Date.now()}`;

    await page.goto('/seller/add-product');
    await page.setInputFiles('#image0', {
      name: 'e2e.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await page.getByLabel('Product Name').fill(name);
    await page.getByLabel('Product Description').fill('Created by the Playwright e2e suite.');
    await page.getByLabel('Category').selectOption('Accessories');
    await page.getByLabel('Product Price').fill('100');
    await page.getByLabel('Offer Price').fill('90');
    await page.getByLabel('Stock').fill('5');
    await page.getByRole('button', { name: 'ADD' }).click();

    await expect(page.getByText('Product added')).toBeVisible({ timeout: 30_000 });

    // Product appears in the seller list...
    await page.goto('/seller/product-list');
    await expect(page.getByText(name)).toBeVisible();

    // ...and on the public storefront.
    await page.goto('/all-products');
    await expect(page.getByText(name).first()).toBeVisible();

    // Clean up via the seller UI (accept the window.confirm dialog).
    await page.goto('/seller/product-list');
    page.on('dialog', (dialog) => dialog.accept());
    const row = page.locator('tr', { hasText: name });
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(name)).toBeHidden({ timeout: 20_000 });
  });

  test('rejects a non-image file at selection time', async ({ page }) => {
    await page.goto('/seller/add-product');
    await page.setInputFiles('#image0', {
      name: 'evil.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(page.getByText('Only JPEG, PNG, and WEBP images are allowed')).toBeVisible();
  });

  test('blocks submitting a product without any image', async ({ page }) => {
    await page.goto('/seller/add-product');
    await page.getByLabel('Product Name').fill('No Image Product');
    await page.getByLabel('Product Description').fill('Should never be created.');
    await page.getByLabel('Product Price').fill('10');
    await page.getByLabel('Offer Price').fill('9');
    await page.getByLabel('Stock').fill('1');

    let createCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/seller/products') && req.method() === 'POST') createCalled = true;
    });
    await page.getByRole('button', { name: 'ADD' }).click();

    await expect(page.getByText('Add at least one product image')).toBeVisible();
    expect(createCalled, 'no create request should be sent without images').toBe(false);
  });
});
