const { test, expect } = require('@playwright/test');

test.describe('auth (guest)', () => {
  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(process.env.E2E_SELLER_EMAIL);
    await page.getByPlaceholder('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Login', exact: true }).click();

    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    expect(page.url()).toContain('/login');
  });

  test('guest cannot open the seller dashboard', async ({ page }) => {
    await page.goto('/seller');
    // The seller layout must bounce unauthenticated visitors away.
    await page.waitForURL((url) => !url.pathname.startsWith('/seller'));
  });
});
