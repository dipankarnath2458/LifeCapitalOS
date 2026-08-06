import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSendResult, EmailTransport } from './email.transport';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/**
 * Resend transport. Uses the REST API over global `fetch` (Node 20+) rather than the
 * `resend` SDK — one HTTP call, no new dependency, and nothing to keep in step.
 *
 * A send never throws: {@link EmailService} treats delivery as best-effort so a provider
 * outage cannot turn "reset your password" into a 500 or leak account existence through a
 * differing response.
 */
export class ResendEmailTransport implements EmailTransport {
  readonly name = 'resend';
  private readonly logger = new Logger(ResendEmailTransport.name);

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Body may carry the provider's reason (unverified domain, bad key, rate limit).
        // Logged, never returned to the HTTP caller.
        const detail = await res.text().catch(() => '');
        this.logger.error(`Resend rejected the send (${res.status}): ${detail.slice(0, 500)}`);
        return { delivered: false, error: `resend_http_${res.status}` };
      }

      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { delivered: true, id: body.id };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Resend send failed: ${reason}`);
      return { delivered: false, error: reason.includes('abort') ? 'timeout' : 'network_error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
