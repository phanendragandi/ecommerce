import { z } from 'zod';
import { ORDER_STATUSES } from '../lib/orderStatus.js';

export const sellerOrderIdParamSchema = z.object({
  id: z.string().uuid('Invalid order id'),
});
export type SellerOrderIdParam = z.infer<typeof sellerOrderIdParamSchema>;

export const sellerOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500, 'note must be at most 500 characters').optional(),
});
export type SellerOrderStatusInput = z.infer<typeof sellerOrderStatusSchema>;
