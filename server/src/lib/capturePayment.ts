import { supabaseAdmin } from './supabaseAdmin.js';
import { HttpError } from '../middleware/errorHandler.js';

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  payment_status: string;
}

interface OrderItemRow {
  product_id: string;
  quantity: number;
}

export interface CaptureResult {
  orderId: string;
  status: string;
  /** True when the order was already captured — no mutation was performed. */
  alreadyPaid: boolean;
}

export interface CaptureParams {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  /**
   * When set (verify path), the order must belong to this user. Omitted for
   * the webhook path, which is authenticated by its HMAC signature instead.
   */
  userId?: string;
}

/**
 * Idempotent payment capture — the single source of the `paid` mutation,
 * shared by POST /payments/verify and the Razorpay webhook. Whichever path
 * lands first performs the mutation EXACTLY once; every later replay (webhook
 * redelivery, tab-close + verify race) sees `payment_status = 'paid'` and
 * returns without touching stock again.
 *
 * On capture, inside this one code path: mark the order paid, decrement stock
 * atomically per line item, insert the `paid` timeline event, and clear the
 * buyer's cart. If a post-payment stock decrement fails, the order STILL
 * counts as paid — we flag it for manual review and log loudly rather than
 * silently swallowing (the buyer has been charged).
 */
export async function capturePayment(params: CaptureParams): Promise<CaptureResult> {
  const { razorpayOrderId, razorpayPaymentId, userId } = params;
  const admin = supabaseAdmin();

  // --- Load the order (owner-scoped on the verify path) ---------------
  let loader = admin
    .from('orders')
    .select('id, user_id, status, payment_status')
    .eq('razorpay_order_id', razorpayOrderId);
  if (userId) {
    loader = loader.eq('user_id', userId);
  }
  const { data: orderData, error: loadError } = await loader.maybeSingle();
  if (loadError) {
    throw new HttpError(500, 'Failed to load order');
  }
  if (!orderData) {
    throw new HttpError(404, 'Order not found');
  }
  const order = orderData as OrderRow;

  // --- Idempotency fast-path: already captured → no-op ----------------
  if (order.payment_status === 'paid') {
    return { orderId: order.id, status: order.status, alreadyPaid: true };
  }

  // --- Atomic claim (compare-and-swap) --------------------------------
  // The read guard above races: the browser verify call and the webhook can
  // both pass it within milliseconds (user stays on the page → both fire).
  // The `.neq('payment_status', 'paid')` predicate turns the mark-paid update
  // into a CAS — exactly ONE concurrent caller mutates a row, and only that
  // winner proceeds to decrement stock, insert the event, and clear the cart.
  // The loser observes `claimed = null` and returns as already-paid without
  // touching stock, so stock is never decremented twice.
  const { data: claimed, error: updateError } = await admin
    .from('orders')
    .update({ status: 'paid', payment_status: 'paid', razorpay_payment_id: razorpayPaymentId })
    .eq('id', order.id)
    .neq('payment_status', 'paid')
    .select('id')
    .maybeSingle();
  if (updateError) {
    throw new HttpError(500, 'Failed to mark order paid');
  }
  if (!claimed) {
    // Another concurrent capture won the race between our read and write.
    return { orderId: order.id, status: 'paid', alreadyPaid: true };
  }

  // --- Decrement stock atomically per line item -----------------------
  const { data: itemsData, error: itemsError } = await admin
    .from('order_items')
    .select('product_id, quantity')
    .eq('order_id', order.id);
  if (itemsError) {
    throw new HttpError(500, 'Failed to load order items');
  }
  const items = (itemsData ?? []) as OrderItemRow[];

  let stockDecrementFailed = false;
  for (const item of items) {
    const { error: rpcError } = await admin.rpc('decrement_stock', {
      p_product_id: item.product_id,
      p_quantity: item.quantity,
    });
    if (rpcError) {
      // The buyer is already charged — never silently swallow. Flag loudly
      // for manual review; the order stays `paid`.
      stockDecrementFailed = true;
      console.error(
        `[capturePayment] STOCK DECREMENT FAILED post-payment — manual review required. ` +
          `order=${order.id} product=${item.product_id} qty=${item.quantity}: ${rpcError.message}`,
      );
    }
  }

  // --- Timeline event -------------------------------------------------
  await admin.from('order_events').insert({
    order_id: order.id,
    status: 'paid',
    note: stockDecrementFailed
      ? 'Payment captured — stock decrement failed, manual review required'
      : 'Payment captured',
  });

  // --- Clear the buyer's cart ----------------------------------------
  await admin.from('cart_items').delete().eq('user_id', order.user_id);

  return { orderId: order.id, status: 'paid', alreadyPaid: false };
}
