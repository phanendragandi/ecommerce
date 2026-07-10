import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { HttpError } from './errorHandler.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth once the bearer token has been verified against Supabase. */
      user?: { id: string; email: string | null };
      /** Set by requireSeller after confirming profiles.role === 'seller' from the DB. */
      sellerProfile?: { role: string };
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the Supabase JWT on every non-public route. Never trusts any
 * client-supplied identity — the user id/email come only from Supabase's
 * verification of the token via the service-role client.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new HttpError(401, 'Missing or invalid Authorization header');
    }

    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) {
      throw new HttpError(401, 'Invalid or expired session');
    }

    req.user = { id: data.user.id, email: data.user.email ?? null };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Must run after requireAuth. Loads the caller's role from `profiles` via
 * the service-role client (never from client-supplied data) and rejects
 * with 403 unless it is 'seller'. The lookup happens once per request —
 * there is no cross-request cache.
 */
export async function requireSeller(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, 'Authentication required');
    }

    const { data, error } = await supabaseAdmin()
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error || !data || (data as { role?: string }).role !== 'seller') {
      throw new HttpError(403, 'Seller access required');
    }

    req.sellerProfile = { role: (data as { role: string }).role };
    next();
  } catch (err) {
    next(err);
  }
}
