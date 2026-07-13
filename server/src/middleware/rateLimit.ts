import rateLimit from 'express-rate-limit';

// Local dev/test gets effectively-unlimited budgets so debounced cart syncs
// and manual testing never trip 429s; production keeps the real limits.
const prod = process.env.NODE_ENV === 'production';
const scale = prod ? 1 : 100;

// General API budget — generous enough for normal browsing.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300 * scale,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, slow down.' },
});

// Routine authenticated writes (cart sync, addresses, seller catalog CRUD,
// fulfillment status updates). Roomier than strict: a debounced cart sync
// alone can produce dozens of PUTs in a session.
export const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120 * scale,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, slow down.' },
});

// Strict budget reserved for money-adjacent routes (checkout, payment verify).
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30 * scale,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, slow down.' },
});
