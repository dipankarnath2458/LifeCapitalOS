import { createHmac } from 'node:crypto';
import { RazorpayService } from './razorpay.service';

function svc(config: Record<string, unknown>) {
  return new RazorpayService({ get: (k: string) => config[k] } as any);
}

const SECRET = 'whsec_test_123';
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('RazorpayService.verifyWebhookSignature', () => {
  const service = svc({ 'razorpay.webhookSecret': SECRET });
  const body = JSON.stringify({ event: 'order.paid' });

  it('accepts a correctly signed payload', () => {
    expect(service.verifyWebhookSignature(body, sign(body))).toBe(true);
    expect(service.verifyWebhookSignature(Buffer.from(body), sign(body))).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const tampered = JSON.stringify({ event: 'order.paid', extra: 'x' });
    expect(service.verifyWebhookSignature(tampered, sign(body))).toBe(false);
  });

  it('rejects a missing or malformed signature', () => {
    expect(service.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(service.verifyWebhookSignature(body, 'deadbeef')).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    const noSecret = svc({ 'razorpay.webhookSecret': '' });
    expect(noSecret.verifyWebhookSignature(body, sign(body))).toBe(false);
  });
});

describe('RazorpayService.live', () => {
  it('is false in sandbox and true only for live keys with sandbox off', () => {
    expect(svc({ 'razorpay.sandbox': true, 'razorpay.keyId': 'rzp_live_x' }).live).toBe(false);
    expect(svc({ 'razorpay.sandbox': false, 'razorpay.keyId': 'rzp_test_x' }).live).toBe(false);
    expect(svc({ 'razorpay.sandbox': false, 'razorpay.keyId': 'rzp_live_x' }).live).toBe(true);
  });
});
