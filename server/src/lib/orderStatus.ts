/**
 * Canonical order-status transition graph.
 *
 * Fulfilment lifecycle (adjacent steps only — no skipping forward):
 *   pending → paid → processing → shipped → out_for_delivery → delivered
 *
 * `pending → paid` is owned by the payment-capture path (verify/webhook).
 *
 * SELLERS may only advance FULFILMENT (paid → … → delivered). Cancellation
 * and refunds are deliberately NOT seller-driven: in a multi-seller order a
 * single seller must not be able to cancel/refund the whole order. Those
 * transitions live on the internal/service + payment paths (see
 * INTERNAL_TRANSITIONS) and will be exposed via an admin/service route later.
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
 * Transitions a SELLER is allowed to perform — fulfilment advancement ONLY.
 * `pending` is empty (only the payment path leaves `pending`); cancelled/
 * refunded are excluded (service/admin path only).
 */
const SELLER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: [],
  paid: ['processing'],
  processing: ['shipped'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
};

/**
 * Full internal transition graph (payment + service/admin paths). Kept
 * available for internal callers; NOT used by the seller-facing route.
 *   pending → paid (payment path)
 *   paid/processing → cancelled → refunded (service/admin + payment paths)
 */
const INTERNAL_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid'],
  paid: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: ['refunded'],
  refunded: [],
};

/** True when a seller may move an order from `from` to `to` (fulfilment only). */
export function isValidSellerTransition(from: OrderStatus, to: OrderStatus): boolean {
  return SELLER_TRANSITIONS[from].includes(to);
}

/** True when an internal/service path may move an order from `from` to `to`. */
export function isValidInternalTransition(from: OrderStatus, to: OrderStatus): boolean {
  return INTERNAL_TRANSITIONS[from].includes(to);
}

export { SELLER_TRANSITIONS, INTERNAL_TRANSITIONS };
