import { z } from 'zod';

export const productListQuerySchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productIdParamSchema = z.object({
  id: z.string().uuid('Invalid product id'),
});
export type ProductIdParam = z.infer<typeof productIdParamSchema>;
