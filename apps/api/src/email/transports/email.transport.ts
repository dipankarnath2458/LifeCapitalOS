/**
 * Transport boundary for outbound email.
 *
 * The application never talks to a provider directly — it composes a {@link EmailMessage}
 * and hands it to whichever transport is configured. Swapping Resend for SES, Postmark or
 * anything else is one new file plus one line in the module; no caller changes.
 */

export const EMAIL_TRANSPORT = 'EMAIL_TRANSPORT';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** Plain-text alternative. Always sent — some clients and most spam filters want it. */
  text: string;
}

export interface EmailSendResult {
  delivered: boolean;
  /** Provider message id when the send succeeded, for support/debugging. */
  id?: string;
  /** Why it failed. Never surfaced to the caller of an auth endpoint. */
  error?: string;
}

export interface EmailTransport {
  /** Human-readable transport name, used in logs and the health payload. */
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
