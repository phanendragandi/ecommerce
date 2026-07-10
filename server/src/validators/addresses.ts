import { z } from 'zod';

export const addressCreateSchema = z.object({
  full_name: z.string().trim().min(1, 'full_name is required').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'phone must be a valid 10-digit India phone number'),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'pincode must be a 6-digit code'),
  area: z.string().trim().min(1, 'area is required').max(200),
  city: z.string().trim().min(1, 'city is required').max(100),
  state: z.string().trim().min(1, 'state is required').max(100),
});
export type AddressCreateInput = z.infer<typeof addressCreateSchema>;

export const addressIdParamSchema = z.object({
  id: z.string().uuid('Invalid address id'),
});
export type AddressIdParam = z.infer<typeof addressIdParamSchema>;
