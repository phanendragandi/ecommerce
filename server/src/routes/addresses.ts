import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { strictLimiter } from '../middleware/rateLimit.js';
import { addressCreateSchema, addressIdParamSchema } from '../validators/addresses.js';

export const addressesRouter = Router();

addressesRouter.use(requireAuth);

// GET /api/addresses — the caller's own addresses.
addressesRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin()
      .from('addresses')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new HttpError(500, 'Failed to fetch addresses');
    }

    res.json({ success: true, data: { addresses: data ?? [] } });
  } catch (err) {
    next(err);
  }
});

// POST /api/addresses — create an address owned by the caller.
addressesRouter.post('/', strictLimiter, async (req, res, next) => {
  try {
    const body = addressCreateSchema.parse(req.body);

    const { data, error } = await supabaseAdmin()
      .from('addresses')
      .insert({ ...body, user_id: req.user!.id })
      .select('*')
      .single();

    if (error || !data) {
      throw new HttpError(500, 'Failed to create address');
    }

    res.status(201).json({ success: true, data: { address: data } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/addresses/:id — owner-scoped delete.
addressesRouter.delete('/:id', strictLimiter, async (req, res, next) => {
  try {
    const { id } = addressIdParamSchema.parse(req.params);

    const { data, error } = await supabaseAdmin()
      .from('addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, 'Failed to delete address');
    }
    if (!data) {
      throw new HttpError(404, 'Address not found');
    }

    res.json({ success: true, data: { address: data } });
  } catch (err) {
    next(err);
  }
});
