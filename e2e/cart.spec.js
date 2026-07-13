const { test, expect } = require('@playwright/test');

const SEED_PRODUCT = 'Bose QuietComfort 45';

test.describe('cart (logged in)', () => {
  test('add to cart from product page and see it in the cart', async ({ page }) => {
    await page.goto('/all-products');
    await page.getByText(SEED_PRODUCT).first().click();
    await page.waitForURL(/\/product\//);

    // Adding is instant locally; the server sync is debounced 800ms. Wait for
    // the PUT to land before a hard navigation, or the item only exists in
    // the about-to-be-discarded client state.
    const syncDone = page.waitForResponse(
      (res) => res.url().includes('/api/cart') && res.request().method() === 'PUT' && res.ok()
    );
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
