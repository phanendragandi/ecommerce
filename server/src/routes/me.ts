import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';

export const meRouter = Router();

// GET /api/me — the authenticated caller's profile row.
meRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin()
      .from('profiles')
      .select('*')
      .eq('id', req.user!.id)
      .single();

    if (error || !data) {
      throw new HttpError(404, 'Profile not found');
    }

    res.json({ success: true, data: { profile: data } });
  } catch (err) {
    next(err);
  }
});
