import Razorpay from 'razorpay';
import { config } from '../config.js';

let client: Razorpay | null = null;

/**
 * Lazy Razorpay client. Instantiated on first use so importing this module
 * never demands the RAZORPAY_* secrets (tests mock this module wholesale).
 * Server-side only — the key secret must never reach the browser.
 */
export function razorpay(): Razorpay {
  if (!client) {
    client = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });
  }
  return client;
}
