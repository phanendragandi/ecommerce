import { z } from 'zod';

export const cartItemSchema = z.object({
  product_id: z.string().uuid('Invalid product id'),
  quantity: z.number().int().positive('quantity must be a positive integer'),
});
export type CartItemInput = z.infer<typeof cartItemSchema>;

export const cartPutSchema = z.object({
  items: z
    .array(cartItemSchema)
    .max(100, 'A cart may contain at most 100 line items')
    .refine(
      (items) => new Set(items.map((item) => item.product_id)).size === items.length,
      { message: 'Duplicate product_id in items' },
    ),
});
export type CartPutInput = z.infer<typeof cartPutSchema>;
