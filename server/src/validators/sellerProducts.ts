import { z } from 'zod';

export const productCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200),
    description: z.string().trim().min(1, 'description is required').max(5000),
    category: z.string().trim().min(1, 'category is required').max(100),
    price: z.number().positive('price must be greater than 0'),
    offer_price: z.number().positive('offer_price must be greater than 0').optional(),
    stock: z.number().int().min(0, 'stock cannot be negative'),
  })
  .refine((body) => body.offer_price === undefined || body.offer_price <= body.price, {
    message: 'offer_price cannot exceed price',
    path: ['offer_price'],
  });
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

const productUpdateBase = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  price: z.number().positive().optional(),
  offer_price: z.number().positive().optional(),
  stock: z.number().int().min(0).optional(),
});

export const productUpdateSchema = productUpdateBase
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  })
  .refine(
    (body) => body.offer_price === undefined || body.price === undefined || body.offer_price <= body.price,
    { message: 'offer_price cannot exceed price', path: ['offer_price'] },
  );
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
