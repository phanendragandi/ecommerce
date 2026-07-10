/**
 * Canonical order-status transition graph.
 *
 * Fulfilment lifecycle (adjacent steps only — no skipping forward):
 *   pending → paid → processing → shipped → out_for_delivery → delivered
 *
 * `pending → paid` is owned by the payment-capture path (verify/webhook),
 * NOT the seller. Everything below is what a seller may drive via
 * PATCH /api/seller/orders/:id/status.
 *
 *   paid       → processing | cancelled
 *   processing → shipped     | cancelled
 *   shipped    → out_for_delivery
 *   out_for_delivery → delivered
 *   cancelled  → refunded
 *
 * `refunded` is only reachable from `cancelled` (a cancelled order being
 * money-returned) — the payment path may also drive refunds out of band.
 */

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Transitions a SELLER is allowed to perform. `pending` is intentionally
 * empty here: only the payment path moves an order out of `pending`.
 */
const SELLER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: [],
  paid: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: ['refunded'],
  refunded: [],
};

/** True when a seller may move an order from `from` to `to`. */
export function isValidSellerTransition(from: OrderStatus, to: OrderStatus): boolean {
  return SELLER_TRANSITIONS[from].includes(to);
}

export { SELLER_TRANSITIONS };
