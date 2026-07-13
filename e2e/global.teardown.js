const { request: pwRequest } = require('@playwright/test');
const { getSellerToken, sweepE2EProducts } = require('./apiHelpers');

// Remove every e2e-created product (fixtures + per-test) after the run.
module.exports = async () => {
  const ctx = await pwRequest.newContext();
  try {
    const token = await getSellerToken(ctx);
    await sweepE2EProducts(ctx, token);
  } catch (err) {
    console.warn('e2e teardown sweep failed:', err.message);
  } finally {
    await ctx.dispose();
  }
};
