import { Router } from 'express';
import { razorpay } from '../lib/razorpay.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { strictLimiter } from '../middleware/rateLimit.js';
import { checkoutSchema } from '../validators/orders.js';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

interface ProductRow {
  id: string;
  name: string;
  price: number | string;
  offer_price: number | string | null;
  stock: number;
}

// POST /api/orders/checkout — create a pending order + Razorpay order.
// The amount is computed SERVER-SIDE from DB prices; client prices are ignored.
ordersRouter.post('/checkout', strictLimiter, async (req, res, next) => {
  try {
    const body = checkoutSchema.parse(req.body);
    const userId = req.user!.id;
    const admin = supabaseAdmin();

    // 1. The address must belong to the caller.
    const { data: address, error: addressError } = await admin
      .from('addresses')
      .select('id')
      .eq('id', body.address_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (addressError) {
      throw new HttpError(500, 'Failed to verify address');
    }
    if (!address) {
      throw new HttpError(404, 'Address not found');
    }

    // 2. Load the products from the DB (active only) — the price authority.
    const productIds = body.items.map((item) => item.product_id);
    const { data: productsData, error: productsError } = await admin
      .from('products')
      .select('id, name, price, offer_price, stock')
      .in('id', productIds)
      .eq('is_active', true);
    if (productsError) {
      throw new HttpError(500, 'Failed to load products');
    }
    const products = (productsData ?? []) as ProductRow[];
    const productById = new Map(products.map((p) => [p.id, p]));

    // 3. Validate availability + stock, compute the amount server-side.
    let amountRupees = 0;
    const orderItemRows: Array<{
      product_id: string;
      quantity: number;
      price_at_purchase: number;
    }> = [];

    for (const item of body.items) {
      const product = productById.get(item.product_id);
      if (!product) {
        throw new HttpError(400, `Product ${item.product_id} is unavailable`);
      }
      if (product.stock < item.quantity) {
        throw new HttpError(400, `Insufficient stock for ${product.name}`);
      }
      const rawUnit = product.offer_price ?? product.price;
      const unitPrice = Number(rawUnit);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new HttpError(500, 'Invalid product price');
      }
      amountRupees += unitPrice * item.quantity;
      orderItemRows.push({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_purchase: unitPrice,
      });
    }

    // Round to 2 decimals (rupees) and derive integer paise for Razorpay.
    amountRupees = Math.round(amountRupees * 100) / 100;
    const amountPaise = Math.round(amountRupees * 100);
    if (amountPaise <= 0) {
      throw new HttpError(400, 'Order total must be greater than zero');
    }

    // 4. Create the pending order row.
    const { data: orderData, error: orderError } = await admin
      .from('orders')
      .insert({
        user_id: userId,
        address_id: body.address_id,
        amount: amountRupees,
        currency: 'INR',
        status: 'pending',
        payment_status: 'pending',
      })
      .select('id')
      .single();
    if (orderError || !orderData) {
      throw new HttpError(500, 'Failed to create order');
    }
    const orderId = (orderData as { id: string }).id;

    // 5. Snapshot the line items (price_at_purchase — never joined live later).
    const { error: itemsError } = await admin
      .from('order_items')
      .insert(orderItemRows.map((row) => ({ order_id: orderId, ...row })));
    if (itemsError) {
      throw new HttpError(500, 'Failed to create order items');
    }

    // 6. Timeline: order created.
    await admin.from('order_events').insert({
      order_id: orderId,
      status: 'pending',
      note: 'Order created',
    });

    // 7. Create the Razorpay order (amount in paise) and persist its id.
    const rzpOrder = await razorpay().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: orderId,
    });

    const { error: rzpUpdateError } = await admin
      .from('orders')
      .update({ razorpay_order_id: rzpOrder.id })
      .eq('id', orderId);
    if (rzpUpdateError) {
      throw new HttpError(500, 'Failed to attach Razorpay order');
    }

    res.status(201).json({
      success: true,
      data: {
        orderId,
        rzpOrderId: rzpOrder.id,
        amount: amountPaise,
        currency: 'INR',
        keyId: config.razorpayKeyId,
      },
    });
  } catch (err) {
    next(err);
  }
});

interface OrderItemEmbed {
  product_id: string;
  quantity: number;
  price_at_purchase: number | string;
  product: { name: string; images: string[] } | null;
}

interface OrderEmbed {
  id: string;
  amount: number | string;
  currency: string;
  status: string;
  payment_status: string;
  created_at: string;
  order_items: OrderItemEmbed[] | null;
}

interface EventRow {
  order_id: string;
  status: string;
  note: string | null;
  created_at: string;
}

// GET /api/orders — the caller's orders, newest first, with items + events.
// Shape is a pinned contract consumed by the frontend My Orders page.
ordersRouter.get('/', async (req, res, next) => {
  try {
    const admin = supabaseAdmin();
    const { data: ordersData, error } = await admin
      .from('orders')
      .select(
        'id, amount, currency, status, payment_status, created_at, ' +
          'order_items(product_id, quantity, price_at_purchase, product:products(name, images))',
      )
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });
    if (error) {
      throw new HttpError(500, 'Failed to fetch orders');
    }

    const orders = (ordersData ?? []) as unknown as OrderEmbed[];
    res.json({ success: true, data: { orders: await attachEvents(orders) } });
  } catch (err) {
    next(err);
  }
});

/**
 * Fetch the `order_events` timeline for a set of orders (ascending) and fold
 * everything into the pinned response shape. Shared by buyer + seller reads.
 */
export async function attachEvents(orders: OrderEmbed[]): Promise<unknown[]> {
  const orderIds = orders.map((order) => order.id);
  const eventsByOrder = new Map<string, EventRow[]>();

  if (orderIds.length > 0) {
    const { data: eventsData, error: eventsError } = await supabaseAdmin()
      .from('order_events')
      .select('order_id, status, note, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: true });
    if (eventsError) {
      throw new HttpError(500, 'Failed to fetch order events');
    }
    for (const event of (eventsData ?? []) as EventRow[]) {
      const bucket = eventsByOrder.get(event.order_id) ?? [];
      bucket.push(event);
      eventsByOrder.set(event.order_id, bucket);
    }
  }

  return orders.map((order) => ({
    id: order.id,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    payment_status: order.payment_status,
    created_at: order.created_at,
    items: (order.order_items ?? []).map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      price_at_purchase: item.price_at_purchase,
      product: item.product ? { name: item.product.name, images: item.product.images } : null,
    })),
    events: (eventsByOrder.get(order.id) ?? []).map((event) => ({
      status: event.status,
      note: event.note,
      created_at: event.created_at,
    })),
  }));
}
