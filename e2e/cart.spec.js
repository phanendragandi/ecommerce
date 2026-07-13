const { test, expect } = require('@playwright/test');

// Provisioned by catalog.setup.js.
const SEED_PRODUCT = 'E2E Fixture Speaker';

test.describe('cart (logged in)', () => {
  test('add to cart from product page and see it in the cart', async ({ page }) => {
    await page.goto('/all-products');
    await page.getByText(SEED_PRODUCT).first().click();
    await page.waitForURL(/\/product\//);

    // Adding is instant locally; the server sync is debounced 800ms. Wait for
    // the PUT that actually carries this product before a hard navigation —
    // matching any PUT can catch the page-load hydration sync (empty cart)
    // and navigate away before the real one fires.
    const productId = page.url().split('/product/')[1].split(/[?#]/)[0];
    const syncDone = page.waitForResponse((res) => {
      if (!res.url().includes('/api/cart')) return false;
      if (res.request().method() !== 'PUT' || !res.ok()) return false;
      return (res.request().postData() || '').includes(productId);
    });
    await page.getByRole('button', { name: 'Add to Cart' }).first().click();
    await syncDone;

    await page.goto('/cart');
    await expect(page.getByText(SEED_PRODUCT).first()).toBeVisible();
  });

  test('cart sync round-trips through the API', async ({ page }) => {
    // Reload wipes client state; the cart page must rehydrate from the server.
    await page.goto('/cart');
    await expect(page.getByText(SEED_PRODUCT).first()).toBeVisible();
  });
});
