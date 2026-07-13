import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { mutationLimiter } from '../middleware/rateLimit.js';
import { cartPutSchema } from '../validators/cart.js';

export const cartRouter = Router();

cartRouter.use(requireAuth);

// GET /api/cart — the caller's cart items.
cartRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin()
      .from('cart_items')
      .select('*')
      .eq('user_id', req.user!.id);

    if (error) {
      throw new HttpError(500, 'Failed to fetch cart');
    }

    res.json({ success: true, data: { items: data ?? [] } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/cart — replace the caller's entire cart.
cartRouter.put('/', mutationLimiter, async (req, res, next) => {
  try {
    const body = cartPutSchema.parse(req.body);
    const userId = req.user!.id;

    const { error: deleteError } = await supabaseAdmin().from('cart_items').delete().eq('user_id', userId);
    if (deleteError) {
      throw new HttpError(500, 'Failed to update cart');
    }

    if (body.items.length === 0) {
      res.json({ success: true, data: { items: [] } });
      return;
    }

    const rows = body.items.map((item) => ({
      user_id: userId,
      product_id: item.product_id,
      quantity: item.quantity,
    }));

    const { data, error: insertError } = await supabaseAdmin().from('cart_items').insert(rows).select('*');

    if (insertError) {
      throw new HttpError(500, 'Failed to update cart');
    }

    res.json({ success: true, data: { items: data ?? [] } });
  } catch (err) {
    next(err);
  }
});
