import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_TRANSPORT, type EmailSendResult, type EmailTransport } from './transports/email.transport';
import { emailVerificationEmail, passwordResetEmail } from './templates';

/**
 * Application-facing email API.
 *
 * Two rules the callers depend on:
 *
 * 1. **A send never throws.** `POST /auth/forgot-password` deliberately answers the same
 *    way whether or not the account exists; a provider outage must not turn that into a
 *    500 (which would leak account existence and break the flow). Failures are logged and
 *    reported in the return value.
 * 2. **One-time secrets never reach a log.** The token is passed to the template and put in
 *    the link; nothing here logs the message body. The console transport is the deliberate
 *    exception, and it only runs when no provider is configured.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    private readonly config: ConfigService,
  ) {}

  /** True when a real provider is wired up (as opposed to the logging fallback). */
  get isConfigured(): boolean {
    return this.transport.name !== 'console';
  }

  get transportName(): string {
    return this.transport.name;
  }

  /** `expiresIn` is human copy for the email body, e.g. "30 minutes". */
  async sendPasswordReset(email: string, token: string, expiresIn: string): Promise<EmailSendResult> {
    const rendered = passwordResetEmail({ appUrl: this.appUrl, email, token, expiresIn });
    return this.dispatch('password_reset', email, rendered);
  }

  async sendEmailVerification(email: string, token: string, expiresIn: string): Promise<EmailSendResult> {
    const rendered = emailVerificationEmail({ appUrl: this.appUrl, email, token, expiresIn });
    return this.dispatch('email_verification', email, rendered);
  }

  private get appUrl(): string {
    return this.config.get<string>('email.appUrl') ?? 'http://localhost:3000';
  }

  private async dispatch(
    kind: string,
    to: string,
    rendered: { subject: string; html: string; text: string },
  ): Promise<EmailSendResult> {
    try {
      const result = await this.transport.send({ to, ...rendered });
      if (!result.delivered) {
        this.logger.error(`Email "${kind}" was not delivered (transport=${this.transport.name}): ${result.error}`);
      }
      return result;
    } catch (err) {
      // A transport is contracted not to throw, but a bug in one must not take down an
      // auth endpoint.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email "${kind}" threw from transport ${this.transport.name}: ${reason}`);
      return { delivered: false, error: 'transport_threw' };
    }
  }
}
