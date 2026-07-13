const { test: setup, request: pwRequest } = require('@playwright/test');
const { getSellerToken, sweepE2EProducts, createProductWithImage, FIXTURE_PRODUCTS } = require('./apiHelpers');

// Provision the catalog fixtures the guest/cart specs assert against.
// Sweep first so an aborted previous run can't leave duplicates.
setup('seed e2e catalog fixtures', async () => {
  const ctx = await pwRequest.newContext();
  try {
    const token = await getSellerToken(ctx);
    await sweepE2EProducts(ctx, token);
    for (const product of FIXTURE_PRODUCTS) {
      await createProductWithImage(ctx, token, product);
    }
  } finally {
    await ctx.dispose();
  }
});
