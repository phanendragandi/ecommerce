import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS — server-side only, and only
 * for privileged paths (order writes, stock mutation, seller analytics).
 * Lazily created so importing this module never demands secrets.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
