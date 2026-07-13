const { test: setup, expect } = require('@playwright/test');

const authFile = 'e2e/.auth/seller.json';

setup('authenticate as demo seller', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(process.env.E2E_SELLER_EMAIL);
  await page.getByPlaceholder('Password').fill(process.env.E2E_SELLER_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();

  // Successful login toasts and redirects to home.
  await expect(page.getByText('Logged in')).toBeVisible();
  await page.waitForURL('/');

  await page.context().storageState({ path: authFile });
});
