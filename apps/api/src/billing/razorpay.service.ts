import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Thin Razorpay integration using the REST API + Node crypto — no SDK dependency.
 * Order creation is used to start a paid subscription; signature verification guards
 * the webhook. In sandbox mode (the default) callers skip live order creation.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  constructor(private readonly config: ConfigService) {}

  /** True only when live keys are configured and sandbox mode is off. */
  get live(): boolean {
    const keyId = this.config.get<string>('razorpay.keyId') ?? '';
    const sandbox = this.config.get<boolean>('razorpay.sandbox') ?? true;
    return !sandbox && keyId.startsWith('rzp_live');
  }

  get keyId(): string {
    return this.config.get<string>('razorpay.keyId') ?? '';
  }

  /**
   * Verify a Razorpay webhook payload. HMAC-SHA256 of the *raw* request body keyed
   * by the webhook secret must equal the `X-Razorpay-Signature` header. Constant-time
   * comparison avoids leaking timing information.
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    const secret = this.config.get<string>('razorpay.webhookSecret') ?? '';
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Create a Razorpay order for a one-time/subscription charge (live mode only). */
  async createOrder(amountMinor: number, currency: string, notes: Record<string, string>): Promise<RazorpayOrder> {
    const keyId = this.config.get<string>('razorpay.keyId');
    const keySecret = this.config.get<string>('razorpay.keySecret');
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountMinor, currency, notes, payment_capture: 1 }),
    });
    if (!res.ok) {
      const detail = await res.text();
      this.logger.error(`Razorpay order creation failed (${res.status}): ${detail}`);
      throw new Error(`Razorpay order creation failed: ${res.status}`);
    }
    return (await res.json()) as RazorpayOrder;
  }
}
