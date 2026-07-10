import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { HttpError } from '../middleware/errorHandler.js';
import { productIdParamSchema, productListQuerySchema } from '../validators/products.js';

export const productsRouter = Router();

// GET /api/products — public listing, active products only.
productsRouter.get('/', async (req, res, next) => {
  try {
    const query = productListQuerySchema.parse(req.query);

    let builder = supabaseAdmin()
      .from('products')
      .select('*', { count: 'exact' })
      .eq('is_active', true);

    if (query.category) {
      builder = builder.eq('category', query.category);
    }
    if (query.q) {
      builder = builder.ilike('name', `%${query.q}%`);
    }

    const { data, error, count } = await builder
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (error) {
      throw new HttpError(500, 'Failed to fetch products');
    }

    res.json({
      success: true,
      data: { products: data ?? [], total: count ?? 0, limit: query.limit, offset: query.offset },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id — public, active product by id.
productsRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = productIdParamSchema.parse(req.params);

    const { data, error } = await supabaseAdmin()
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, 'Failed to fetch product');
    }
    if (!data) {
      throw new HttpError(404, 'Product not found');
    }

    res.json({ success: true, data: { product: data } });
  } catch (err) {
    next(err);
  }
});
