import crypto from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { config } from '../config.js';
import { capturePayment } from '../lib/capturePayment.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { strictLimiter } from '../middleware/rateLimit.js';
import { verifySchema } from '../validators/payments.js';

/** Constant-time string compare that never throws on length mismatch. */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export const paymentsRouter = Router();

// POST /api/payments/verify — browser success-handler fast-path (UX only;
// the webhook is the source of truth). Verifies the HMAC signature, then
// runs the shared idempotent capture.
paymentsRouter.post('/verify', requireAuth, strictLimiter, async (req, res, next) => {
  try {
    const body = verifySchema.parse(req.body);

    const expected = crypto
      .createHmac('sha256', config.razorpayKeySecret)
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
      .digest('hex');

    if (!timingSafeStringEqual(expected, body.razorpay_signature)) {
      // Tampered/forged signature — reject; the order stays pending.
      throw new HttpError(400, 'Invalid payment signature');
    }

    const result = await capturePayment({
      razorpayOrderId: body.razorpay_order_id,
      razorpayPaymentId: body.razorpay_payment_id,
      userId: req.user!.id,
    });

    res.json({ success: true, data: { orderId: result.orderId, status: result.status } });
  } catch (err) {
    next(err);
  }
});

interface WebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
      };
    };
  };
}

/**
 * POST /api/payments/webhook — Razorpay server-to-server callback and the
 * SOURCE OF TRUTH for `paid`. Mounted with express.raw() BEFORE the JSON
 * parser so the HMAC is verified against the exact raw bytes. No auth
 * middleware (Razorpay calls it); the signature IS the authentication.
 *
 * Always responds 200 fast on a valid signature (even for unknown events);
 * processing is idempotent so redelivery never double-decrements stock.
 */
export const webhookHandler: RequestHandler = async (req: Request, res: Response) => {
  // --- Signature verification (400, no processing) --------------------
  const signature = req.header('X-Razorpay-Signature') ?? '';
  // With express.raw(), req.body is a Buffer of the exact request bytes.
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

  const expected = crypto
    .createHmac('sha256', config.razorpayWebhookSecret)
    .update(rawBody)
    .digest('hex');

  if (!timingSafeStringEqual(expected, signature)) {
    res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    return;
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as WebhookPayload;
  } catch {
    res.status(400).json({ success: false, message: 'Malformed webhook body' });
    return;
  }

  const event = payload.event;
  const entity = payload.payload?.payment?.entity;
  const razorpayOrderId = entity?.order_id;
  const razorpayPaymentId = entity?.id;

  // --- Event dispatch -------------------------------------------------
  // Return 200 when the event was processed, is an idempotent replay
  // (alreadyPaid), or is a genuine no-op/unknown event. Return 500 ONLY when
  // processing throws (e.g. a transient DB error) so Razorpay retries the
  // delivery — capture is idempotent, so a retry is safe.
  try {
    if (event === 'payment.captured' && razorpayOrderId && razorpayPaymentId) {
      // Same idempotent capture path as verify. A replay finds the order
      // already `paid` and returns (alreadyPaid) without touching stock.
      await capturePayment({ razorpayOrderId, razorpayPaymentId });
    } else if (event === 'payment.failed' && razorpayOrderId) {
      await markPaymentFailed(razorpayOrderId);
    }
    // Unknown/irrelevant events: acknowledge without processing.

    res.status(200).json({ success: true });
  } catch (err) {
    // Never leak internals. Ask Razorpay to retry — the capture is
    // idempotent and any partial state is reconciled on the next delivery.
    console.error('[webhook] processing error:', err instanceof Error ? err.message : err);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
};

/** Mark an order's payment as failed (stock untouched) + timeline event. */
async function markPaymentFailed(razorpayOrderId: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: orderData } = await admin
    .from('orders')
    .select('id, payment_status')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  const order = orderData as { id: string; payment_status: string } | null;
  if (!order || order.payment_status === 'paid') {
    // No order, or already captured — do not clobber a successful payment.
    return;
  }

  await admin.from('orders').update({ payment_status: 'failed' }).eq('id', order.id);
  await admin.from('order_events').insert({
    order_id: order.id,
    status: 'pending',
    note: 'Payment failed',
  });
}
