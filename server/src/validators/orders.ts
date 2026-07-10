import { z } from 'zod';

/**
 * Checkout body. The client sends ONLY product ids + quantities and an
 * address id — never prices or totals. The server computes the amount
 * from DB `offer_price ?? price` at checkout time.
 */
export const checkoutSchema = z.object({
  address_id: z.string().uuid('Invalid address id'),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid('Invalid product id'),
        quantity: z.number().int().positive('quantity must be a positive integer'),
      }),
    )
    .min(1, 'At least one item is required')
    .max(50, 'A checkout may contain at most 50 line items')
    .refine(
      (items) => new Set(items.map((item) => item.product_id)).size === items.length,
      { message: 'Duplicate product_id in items' },
    ),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
