import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Lazy getters: secrets are only demanded when a code path actually
  // needs them, so tests and the health check don't require a full env.
  get supabaseUrl(): string {
    return required('SUPABASE_URL');
  },
  get supabaseServiceRoleKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get razorpayKeyId(): string {
    return required('RAZORPAY_KEY_ID');
  },
  get razorpayKeySecret(): string {
    return required('RAZORPAY_KEY_SECRET');
  },
  get razorpayWebhookSecret(): string {
    return required('RAZORPAY_WEBHOOK_SECRET');
  },
};
