import { Router } from 'express';
import { fetchEventsByOrder, shapeEvents } from './orders.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { isValidSellerTransition, type OrderStatus } from '../lib/orderStatus.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { strictLimiter } from '../middleware/rateLimit.js';
import { sellerOrderIdParamSchema, sellerOrderStatusSchema } from '../validators/sellerOrders.js';

export const sellerOrdersRouter = Router();

sellerOrdersRouter.use(requireAuth, requireSeller);

interface SellerItemEmbed {
  product_id: string;
  quantity: number;
  price_at_purchase: number | string;
  product: { name: string; images: string[]; seller_id: string } | null;
}

interface SellerOrderEmbed {
  id: string;
  currency: string;
  status: string;
  payment_status: string;
  created_at: string;
  order_items: SellerItemEmbed[] | null;
}

// GET /api/seller/orders — orders containing at least one of this seller's
// products, newest first. IMPORTANT: the response is SELLER-SCOPED — only the
// seller's own line items are returned, and the money figure is their
// `seller_subtotal` (not the buyer's full order amount), so a seller can never
// see co-sellers' items or the whole-order total in a multi-seller order.
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

    // 3. The orders + embedded items (product carries seller_id so we can
    //    filter each order down to THIS seller's items).
    const { data: ordersData, error: ordersError } = await admin
      .from('orders')
      .select(
        'id, currency, status, payment_status, created_at, ' +
          'order_items(product_id, quantity, price_at_purchase, product:products(name, images, seller_id))',
      )
      .in('id', orderIds)
      .order('created_at', { ascending: false });
    if (ordersError) {
      throw new HttpError(500, 'Failed to load seller orders');
    }

    const orders = (ordersData ?? []) as unknown as SellerOrderEmbed[];
    const eventsByOrder = await fetchEventsByOrder(orders.map((order) => order.id));

    const shaped = orders.map((order) => {
      // Only this seller's line items — never expose co-sellers' items.
      const sellerItems = (order.order_items ?? []).filter(
        (item) => item.product?.seller_id === sellerId,
      );
      const sellerSubtotal =
        Math.round(
          sellerItems.reduce(
            (sum, item) => sum + Number(item.price_at_purchase) * item.quantity,
            0,
          ) * 100,
        ) / 100;

      return {
        id: order.id,
        // Least-breaking: `amount` is kept but re-scoped to the seller's
        // subtotal, and also exposed explicitly as `seller_subtotal`.
        amount: sellerSubtotal,
        seller_subtotal: sellerSubtotal,
        currency: order.currency,
        status: order.status,
        payment_status: order.payment_status,
        created_at: order.created_at,
        items: sellerItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          price_at_purchase: item.price_at_purchase,
          product: item.product ? { name: item.product.name, images: item.product.images } : null,
        })),
        events: shapeEvents(eventsByOrder.get(order.id)),
      };
    });

    res.json({ success: true, data: { orders: shaped } });
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
