import rateLimit from 'express-rate-limit';

// General API budget — generous enough for normal browsing.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, slow down.' },
});

// Strict budget for money-adjacent routes (/payments, checkout).
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, slow down.' },
});
