import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer, { MulterError } from 'multer';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { mutationLimiter } from '../middleware/rateLimit.js';
import { productIdParamSchema } from '../validators/products.js';
import { productCreateSchema, productUpdateSchema } from '../validators/sellerProducts.js';

export const sellerProductsRouter = Router();

sellerProductsRouter.use(requireAuth, requireSeller);

// GET /api/seller/products — the seller's own products, including inactive.
sellerProductsRouter.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin()
      .from('products')
      .select('*')
      .eq('seller_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new HttpError(500, 'Failed to fetch products');
    }

    res.json({ success: true, data: { products: data ?? [] } });
  } catch (err) {
    next(err);
  }
});

// POST /api/seller/products — create a product owned by the caller.
sellerProductsRouter.post('/', mutationLimiter, async (req, res, next) => {
  try {
    const body = productCreateSchema.parse(req.body);

    const { data, error } = await supabaseAdmin()
      .from('products')
      .insert({ ...body, seller_id: req.user!.id, images: [], is_active: true })
      .select('*')
      .single();

    if (error || !data) {
      throw new HttpError(500, 'Failed to create product');
    }

    res.status(201).json({ success: true, data: { product: data } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/seller/products/:id — partial update, ownership enforced in the query.
sellerProductsRouter.patch('/:id', mutationLimiter, async (req, res, next) => {
  try {
    const { id } = productIdParamSchema.parse(req.params);
    const body = productUpdateSchema.parse(req.body);

    const { data, error } = await supabaseAdmin()
      .from('products')
      .update(body)
      .eq('id', id)
      .eq('seller_id', req.user!.id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, 'Failed to update product');
    }
    if (!data) {
      throw new HttpError(404, 'Product not found');
    }

    res.json({ success: true, data: { product: data } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/seller/products/:id — permanently removes the product when it
// has never been ordered; otherwise deactivates it (order history must keep
// referencing the row). `data.mode` tells the client which one happened.
sellerProductsRouter.delete('/:id', mutationLimiter, async (req, res, next) => {
  try {
    const { id } = productIdParamSchema.parse(req.params);

    const { count, error: refError } = await supabaseAdmin()
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', id);

    if (refError) {
      throw new HttpError(500, 'Failed to delete product');
    }

    if ((count ?? 0) > 0) {
      const { data, error } = await supabaseAdmin()
        .from('products')
        .update({ is_active: false })
        .eq('id', id)
        .eq('seller_id', req.user!.id)
        .select('*')
        .maybeSingle();

      if (error) {
        throw new HttpError(500, 'Failed to delete product');
      }
      if (!data) {
        throw new HttpError(404, 'Product not found');
      }

      res.json({ success: true, data: { mode: 'deactivated', product: data } });
      return;
    }

    const { data, error } = await supabaseAdmin()
      .from('products')
      .delete()
      .eq('id', id)
      .eq('seller_id', req.user!.id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, 'Failed to delete product');
    }
    if (!data) {
      throw new HttpError(404, 'Product not found');
    }

    res.json({ success: true, data: { mode: 'deleted', product: data } });
  } catch (err) {
    next(err);
  }
});

// --- Image upload -----------------------------------------------------
// POST /api/seller/products/:id/images
// multipart/form-data, field name "images", up to 4 files, 5MB each,
// jpeg/png/webp only. Objects are stored at `<sellerId>/<uuid>.<ext>` in
// the `product-images` bucket — storage RLS enforces the owner-per-path
// contract, so the seller id MUST be the first path segment.

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TO_EXT, file.mimetype)) {
      cb(new HttpError(400, 'Only JPEG, PNG, and WEBP images are allowed'));
      return;
    }
    cb(null, true);
  },
});

function uploadImagesMiddleware(req: Request, res: Response, next: NextFunction): void {
  upload.array('images', 4)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError) {
      next(new HttpError(400, err.message));
      return;
    }
    next(err);
  });
}

sellerProductsRouter.post(
  '/:id/images',
  mutationLimiter,
  uploadImagesMiddleware,
  async (req, res, next) => {
    try {
      const { id } = productIdParamSchema.parse(req.params);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (files.length === 0) {
        throw new HttpError(400, 'At least one image file is required');
      }

      const sellerId = req.user!.id;

      const { data: existing, error: fetchError } = await supabaseAdmin()
        .from('products')
        .select('id, images')
        .eq('id', id)
        .eq('seller_id', sellerId)
        .maybeSingle();

      if (fetchError) {
        throw new HttpError(500, 'Failed to load product');
      }
      if (!existing) {
        throw new HttpError(404, 'Product not found');
      }

      const uploadedUrls: string[] = [];
      for (const file of files) {
        const ext = ALLOWED_MIME_TO_EXT[file.mimetype];
        const objectKey = `${sellerId}/${randomUUID()}.${ext}`;

        const { error: uploadError } = await supabaseAdmin()
          .storage.from('product-images')
          .upload(objectKey, file.buffer, { contentType: file.mimetype, upsert: false });

        if (uploadError) {
          throw new HttpError(500, 'Failed to upload image');
        }

        const { data: publicUrlData } = supabaseAdmin().storage.from('product-images').getPublicUrl(objectKey);
        uploadedUrls.push(publicUrlData.publicUrl);
      }

      const existingImages = Array.isArray((existing as { images?: unknown }).images)
        ? ((existing as { images: string[] }).images)
        : [];
      const nextImages = [...existingImages, ...uploadedUrls];

      const { data: updated, error: updateError } = await supabaseAdmin()
        .from('products')
        .update({ images: nextImages })
        .eq('id', id)
        .eq('seller_id', sellerId)
        .select('*')
        .single();

      if (updateError || !updated) {
        throw new HttpError(500, 'Failed to save image URLs');
      }

      res.status(201).json({ success: true, data: { product: updated } });
    } catch (err) {
      next(err);
    }
  },
);
