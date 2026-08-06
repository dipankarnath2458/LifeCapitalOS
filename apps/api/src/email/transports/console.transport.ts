import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailSendResult, EmailTransport } from './email.transport';

/**
 * Development/CI transport: logs the message instead of sending it.
 *
 * This is what runs when no provider is configured, so local dev and CI need no account,
 * no API key and no network. The reset link is printed so a developer can follow it.
 *
 * It is deliberately NOT silent about being a no-op — a production deploy that lands here
 * has misconfigured email, and the log line is how that gets noticed.
 */
@Injectable()
export class ConsoleEmailTransport implements EmailTransport {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleEmailTransport.name);

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.logger.log(
      `[email:console] NOT SENT (no provider configured) → to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
    return { delivered: true, id: 'console' };
  }
}
