import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { addressesRouter } from './routes/addresses.js';
import { cartRouter } from './routes/cart.js';
import { meRouter } from './routes/me.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter, webhookHandler } from './routes/payments.js';
import { productsRouter } from './routes/products.js';
import { sellerOrdersRouter } from './routes/sellerOrders.js';
import { sellerProductsRouter } from './routes/sellerProducts.js';
import { sellerReportsRouter, sellerStatsRouter } from './routes/sellerStats.js';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind Nginx in production — trust exactly one proxy hop so
  // express-rate-limit sees real client IPs without being spoofable.
  app.set('trust proxy', config.isProd ? 1 : false);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: false,
    }),
  );

  // NOTE (Phase 3B): the Razorpay webhook route must be mounted with
  // express.raw() BEFORE this json parser so its HMAC is computed over the
  // exact raw body. It is intentionally EXEMPT from both rate limiters — the
  // X-Razorpay-Signature HMAC is the authentication, and IP-based limiting
  // could 429 a legitimate Razorpay redelivery burst. Mounting it here (ahead
  // of express.json + apiLimiter) keeps it off both.
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    webhookHandler,
  );

  app.use(express.json({ limit: '1mb' }));

  app.use(apiLimiter);

  app.get('/health', (_req, res) => {
    res.json({ success: true, status: 'ok' });
  });

  app.use('/api/products', productsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/addresses', addressesRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/seller/products', sellerProductsRouter);

  // Phase 3B (payments-engineer):
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/seller/orders', sellerOrdersRouter);

  // Phase 4 (dashboard-engineer): seller analytics.
  app.use('/api/seller/stats', sellerStatsRouter);
  app.use('/api/seller/reports', sellerReportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
