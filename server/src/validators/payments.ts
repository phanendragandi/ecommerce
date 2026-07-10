import { z } from 'zod';

/** Razorpay Checkout success-handler payload verified against the key secret. */
export const verifySchema = z.object({
  razorpay_order_id: z.string().min(1, 'razorpay_order_id is required'),
  razorpay_payment_id: z.string().min(1, 'razorpay_payment_id is required'),
  razorpay_signature: z.string().min(1, 'razorpay_signature is required'),
});
export type VerifyInput = z.infer<typeof verifySchema>;
