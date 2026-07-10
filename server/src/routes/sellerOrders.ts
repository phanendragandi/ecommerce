import { Router } from 'express';
import { attachEvents } from './orders.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { isValidSellerTransition, type OrderStatus } from '../lib/orderStatus.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { strictLimiter } from '../middleware/rateLimit.js';
import { sellerOrderIdParamSchema, sellerOrderStatusSchema } from '../validators/sellerOrders.js';

export const sellerOrdersRouter = Router();

sellerOrdersRouter.use(requireAuth, requireSeller);

// GET /api/seller/orders — orders containing at least one of this seller's
// products, newest first, in the same shape as GET /api/orders.
sellerOrdersRouter.get('/', async (req, res, next) => {
  try {
    const admin = supabaseAdmin();
    const sellerId = req.user!.id;

    // 1. This seller's product ids.
    const { data: productsData, error: productsError } = await admin
      .from('products')
      .select('id')
      .eq('seller_id', sellerId);
    if (productsError) {
      throw new HttpError(500, 'Failed to load seller products');
    }
    const productIds = ((productsData ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (productIds.length === 0) {
      res.json({ success: true, data: { orders: [] } });
      return;
    }

    // 2. Order ids that contain one of those products.
    const { data: itemsData, error: itemsError } = await admin
      .from('order_items')
      .select('order_id')
      .in('product_id', productIds);
    if (itemsError) {
      throw new HttpError(500, 'Failed to load seller orders');
    }
    const orderIds = Array.from(
      new Set(((itemsData ?? []) as Array<{ order_id: string }>).map((row) => row.order_id)),
    );
    if (orderIds.length === 0) {
      res.json({ success: true, data: { orders: [] } });
      return;
    }

    // 3. The orders + embedded items.
    const { data: ordersData, error: ordersError } = await admin
      .from('orders')
      .select(
        'id, amount, currency, status, payment_status, created_at, ' +
          'order_items(product_id, quantity, price_at_purchase, product:products(name, images))',
      )
      .in('id', orderIds)
      .order('created_at', { ascending: false });
    if (ordersError) {
      throw new HttpError(500, 'Failed to load seller orders');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = await attachEvents((ordersData ?? []) as any);
    res.json({ success: true, data: { orders } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/seller/orders/:id/status — drive a fulfilment transition.
// Only valid graph transitions are allowed, and the seller must own at least
// one product in the order. Every change inserts an order_events row.
sellerOrdersRouter.patch('/:id/status', strictLimiter, async (req, res, next) => {
  try {
    const { id } = sellerOrderIdParamSchema.parse(req.params);
    const body = sellerOrderStatusSchema.parse(req.body);
    const admin = supabaseAdmin();
    const sellerId = req.user!.id;

    // Load the order's current status.
    const { data: orderData, error: orderError } = await admin
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (orderError) {
      throw new HttpError(500, 'Failed to load order');
    }
    if (!orderData) {
      throw new HttpError(404, 'Order not found');
    }
    const order = orderData as { id: string; status: OrderStatus };

    // The seller must own at least one product in this order.
    const { data: ownedItem, error: ownershipError } = await admin
      .from('order_items')
      .select('id, products!inner(seller_id)')
      .eq('order_id', id)
      .eq('products.seller_id', sellerId)
      .limit(1)
      .maybeSingle();
    if (ownershipError) {
      throw new HttpError(500, 'Failed to verify order ownership');
    }
    if (!ownedItem) {
      // Do not reveal the existence of orders the seller has no stake in.
      throw new HttpError(404, 'Order not found');
    }

    // Enforce the transition graph.
    if (!isValidSellerTransition(order.status, body.status)) {
      throw new HttpError(400, `Invalid status transition: ${order.status} → ${body.status}`);
    }

    const { error: updateError } = await admin
      .from('orders')
      .update({ status: body.status })
      .eq('id', id);
    if (updateError) {
      throw new HttpError(500, 'Failed to update order status');
    }

    await admin.from('order_events').insert({
      order_id: id,
      status: body.status,
      note: body.note ?? null,
    });

    res.json({ success: true, data: { orderId: id, status: body.status } });
  } catch (err) {
    next(err);
  }
});
