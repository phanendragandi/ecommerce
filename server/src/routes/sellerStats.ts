import { Router } from 'express';
import { ORDER_STATUSES } from '../lib/orderStatus.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { salesReportQuerySchema, topProductsQuerySchema } from '../validators/sellerStats.js';

/**
 * Seller analytics — dashboard stats + time-bucketed / top-product reports.
 *
 * SELLER-SCOPING RULE (see sellerOrders.ts for the established pattern):
 * every aggregate here is computed over `order_items` joined to `products`
 * WHERE products.seller_id = the caller, and only ever surfaces the caller's
 * own line items / product names / revenue — never a co-seller's data or a
 * whole multi-seller order's total. Revenue = SUM(price_at_purchase *
 * quantity) over the seller's OWN items, restricted to orders with
 * payment_status = 'paid' (cancelled/refunded/pending/failed excluded).
 *
 * No live DB in this environment — buckets/top-N are aggregated in
 * TypeScript over fetched rows rather than via SQL RPCs (see task brief).
 */

export const sellerStatsRouter = Router();
export const sellerReportsRouter = Router();

sellerStatsRouter.use(requireAuth, requireSeller);
sellerReportsRouter.use(requireAuth, requireSeller);

// --- shared helpers --------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Supabase caps `select()` results at 1000 rows by default. A seller with
 * more than 1000 matching `order_items` rows would otherwise be silently
 * truncated (under-reported revenue/units/series/top-products). This walks
 * `.range(offset, offset + PAGE_SIZE - 1)` pages, accumulating rows until a
 * short (or empty) page confirms the end of the result set.
 */
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  errorMessage: string,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new HttpError(500, errorMessage);
    }
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }
  return all;
}

interface SellerProductRow {
  id: string;
  name: string;
  stock: number;
  is_active: boolean;
}

interface OrderItemWithOrderEmbed {
  order_id: string;
  quantity: number;
  price_at_purchase: number | string;
  orders: { status: string; payment_status: string } | null;
}

// --- GET /api/seller/stats --------------------------------------------------

sellerStatsRouter.get('/', async (req, res, next) => {
  try {
    const admin = supabaseAdmin();
    const sellerId = req.user!.id;

    const { data: productsData, error: productsError } = await admin
      .from('products')
      .select('id, name, stock, is_active')
      .eq('seller_id', sellerId);
    if (productsError) {
      throw new HttpError(500, 'Failed to load seller products');
    }
    const products = (productsData ?? []) as SellerProductRow[];
    const productIds = products.map((p) => p.id);

    const lowStock = products
      .filter((p) => p.is_active && p.stock <= 5)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 10)
      .map((p) => ({ id: p.id, name: p.name, stock: p.stock }));

    const statusBreakdown: Record<string, number> = Object.fromEntries(
      ORDER_STATUSES.map((status) => [status, 0]),
    );

    if (productIds.length === 0) {
      res.json({
        success: true,
        data: {
          revenue: 0,
          order_count: 0,
          paid_order_count: 0,
          aov: 0,
          units_sold: 0,
          low_stock: lowStock,
          status_breakdown: statusBreakdown,
        },
      });
      return;
    }

    // order_items joined to orders (status/payment_status only — no other
    // seller's product/line-item data is ever selected here). Paginated —
    // see fetchAllPages — so sellers with >1000 line items aren't truncated.
    const items = await fetchAllPages<OrderItemWithOrderEmbed>(
      (from, to) =>
        admin
          .from('order_items')
          .select('order_id, quantity, price_at_purchase, orders!inner(status, payment_status)')
          .in('product_id', productIds)
          .range(from, to) as unknown as PromiseLike<PageResult<OrderItemWithOrderEmbed>>,
      'Failed to load seller order data',
    );

    const orderStatusById = new Map<string, string>();
    const paidOrderIds = new Set<string>();
    let revenue = 0;
    let unitsSold = 0;

    for (const item of items) {
      const order = item.orders;
      if (!order) continue;
      if (!orderStatusById.has(item.order_id)) {
        orderStatusById.set(item.order_id, order.status);
      }
      if (order.payment_status === 'paid') {
        revenue += Number(item.price_at_purchase) * item.quantity;
        unitsSold += item.quantity;
        paidOrderIds.add(item.order_id);
      }
    }

    for (const status of orderStatusById.values()) {
      statusBreakdown[status] = (statusBreakdown[status] ?? 0) + 1;
    }

    const orderCount = orderStatusById.size;
    const paidOrderCount = paidOrderIds.size;
    revenue = round2(revenue);
    // AOV is per PAID order (not per order of any status) — mixing the paid
    // revenue numerator with an all-statuses denominator understates AOV.
    const aov = paidOrderCount > 0 ? round2(revenue / paidOrderCount) : 0;

    res.json({
      success: true,
      data: {
        revenue,
        order_count: orderCount,
        paid_order_count: paidOrderCount,
        aov,
        units_sold: unitsSold,
        low_stock: lowStock,
        status_breakdown: statusBreakdown,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- date-bucket helpers (day|week|month), UTC-safe, mirrors Postgres
//     date_trunc semantics (week = ISO Monday start) -----------------------

type Interval = 'day' | 'week' | 'month';

function truncateUTC(date: Date, interval: Interval): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (interval === 'month') {
    return new Date(Date.UTC(y, m, 1));
  }
  const dayDate = new Date(Date.UTC(y, m, d));
  if (interval === 'day') {
    return dayDate;
  }
  const dow = dayDate.getUTCDay(); // 0 = Sun .. 6 = Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  dayDate.setUTCDate(dayDate.getUTCDate() + diffToMonday);
  return dayDate;
}

function advanceBucket(date: Date, interval: Interval): Date {
  const next = new Date(date);
  if (interval === 'day') {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (interval === 'week') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

function formatBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// --- GET /api/seller/reports/sales -----------------------------------------

interface SalesOrderItemEmbed {
  order_id: string;
  quantity: number;
  price_at_purchase: number | string;
  orders: { created_at: string; payment_status: string } | null;
}

sellerReportsRouter.get('/sales', async (req, res, next) => {
  try {
    const query = salesReportQuerySchema.parse(req.query);
    const admin = supabaseAdmin();
    const sellerId = req.user!.id;
    const interval = query.interval;

    const fromDay = truncateUTC(new Date(query.from), 'day');
    const toDay = truncateUTC(new Date(query.to), 'day');
    const toDayExclusive = advanceBucket(toDay, 'day');

    // Zero-filled bucket skeleton across the whole requested range.
    const bucketOrder: string[] = [];
    const series = new Map<string, { revenue: number; units: number; orderIds: Set<string> }>();
    let cursor = truncateUTC(fromDay, interval);
    let guard = 0;
    while (cursor <= toDay && guard < 1000) {
      const key = formatBucket(cursor);
      if (!series.has(key)) {
        series.set(key, { revenue: 0, units: 0, orderIds: new Set() });
        bucketOrder.push(key);
      }
      cursor = advanceBucket(cursor, interval);
      guard += 1;
    }

    const { data: productsData, error: productsError } = await admin
      .from('products')
      .select('id')
      .eq('seller_id', sellerId);
    if (productsError) {
      throw new HttpError(500, 'Failed to load seller products');
    }
    const productIds = ((productsData ?? []) as Array<{ id: string }>).map((p) => p.id);

    if (productIds.length > 0) {
      const items = await fetchAllPages<SalesOrderItemEmbed>(
        (from, to) =>
          admin
            .from('order_items')
            .select('order_id, quantity, price_at_purchase, orders!inner(created_at, payment_status)')
            .in('product_id', productIds)
            .range(from, to) as unknown as PromiseLike<PageResult<SalesOrderItemEmbed>>,
        'Failed to load sales data',
      );

      for (const item of items) {
        const order = item.orders;
        if (!order || order.payment_status !== 'paid') continue;
        const createdAt = new Date(order.created_at);
        if (Number.isNaN(createdAt.getTime())) continue;
        if (createdAt < fromDay || createdAt >= toDayExclusive) continue;

        const bucketKey = formatBucket(truncateUTC(createdAt, interval));
        const bucket = series.get(bucketKey);
        if (!bucket) continue; // outside the zero-filled skeleton — shouldn't happen
        bucket.revenue += Number(item.price_at_purchase) * item.quantity;
        bucket.units += item.quantity;
        bucket.orderIds.add(item.order_id);
      }
    }

    const seriesOut = bucketOrder.map((key) => {
      const bucket = series.get(key)!;
      return {
        bucket: key,
        revenue: round2(bucket.revenue),
        units: bucket.units,
        orders: bucket.orderIds.size,
      };
    });

    res.json({ success: true, data: { series: seriesOut } });
  } catch (err) {
    next(err);
  }
});

// --- GET /api/seller/reports/top-products -----------------------------------

interface TopProductsItemEmbed {
  product_id: string;
  quantity: number;
  price_at_purchase: number | string;
  orders: { created_at: string; payment_status: string } | null;
}

sellerReportsRouter.get('/top-products', async (req, res, next) => {
  try {
    const query = topProductsQuerySchema.parse(req.query);
    const admin = supabaseAdmin();
    const sellerId = req.user!.id;

    const fromDay = truncateUTC(new Date(query.from), 'day');
    const toDayExclusive = advanceBucket(truncateUTC(new Date(query.to), 'day'), 'day');

    const { data: productsData, error: productsError } = await admin
      .from('products')
      .select('id, name')
      .eq('seller_id', sellerId);
    if (productsError) {
      throw new HttpError(500, 'Failed to load seller products');
    }
    const products = (productsData ?? []) as Array<{ id: string; name: string }>;
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    const productIds = products.map((p) => p.id);

    const totals = new Map<string, { units: number; revenue: number }>();

    if (productIds.length > 0) {
      const items = await fetchAllPages<TopProductsItemEmbed>(
        (from, to) =>
          admin
            .from('order_items')
            .select('product_id, quantity, price_at_purchase, orders!inner(created_at, payment_status)')
            .in('product_id', productIds)
            .range(from, to) as unknown as PromiseLike<PageResult<TopProductsItemEmbed>>,
        'Failed to load top-products data',
      );

      for (const item of items) {
        const order = item.orders;
        if (!order || order.payment_status !== 'paid') continue;
        const createdAt = new Date(order.created_at);
        if (Number.isNaN(createdAt.getTime())) continue;
        if (createdAt < fromDay || createdAt >= toDayExclusive) continue;

        const entry = totals.get(item.product_id) ?? { units: 0, revenue: 0 };
        entry.units += item.quantity;
        entry.revenue += Number(item.price_at_purchase) * item.quantity;
        totals.set(item.product_id, entry);
      }
    }

    const productsRanked = Array.from(totals.entries())
      .map(([productId, totalsEntry]) => ({
        product_id: productId,
        name: nameById.get(productId) ?? 'Unknown product',
        units: totalsEntry.units,
        revenue: round2(totalsEntry.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, query.limit);

    res.json({ success: true, data: { products: productsRanked } });
  } catch (err) {
    next(err);
  }
});
