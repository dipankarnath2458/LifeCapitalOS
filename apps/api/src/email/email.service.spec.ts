import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { emailVerificationEmail, passwordResetEmail } from './templates';
import { escapeHtml } from './templates/layout';
import type { EmailMessage, EmailSendResult, EmailTransport } from './transports/email.transport';

/**
 * The load-bearing property here is that a send NEVER throws. `POST /auth/forgot-password`
 * answers identically whether or not the account exists; if a provider outage turned that
 * into a 500, the endpoint would become an account-existence oracle and the reset flow
 * would break exactly when someone needs it.
 */

class RecordingTransport implements EmailTransport {
  readonly name = 'recording';
  readonly sent: EmailMessage[] = [];
  constructor(private readonly result: EmailSendResult = { delivered: true, id: 'msg_1' }) {}
  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    return this.result;
  }
}

class ThrowingTransport implements EmailTransport {
  readonly name = 'throwing';
  async send(): Promise<EmailSendResult> {
    throw new Error('provider exploded');
  }
}

function service(transport: EmailTransport, appUrl = 'https://lifecapitalos.com'): EmailService {
  const config = { get: (key: string) => (key === 'email.appUrl' ? appUrl : undefined) } as ConfigService;
  return new EmailService(transport, config);
}

describe('EmailService', () => {
  it('sends a password reset with a link back to the web app', async () => {
    const transport = new RecordingTransport();
    const result = await service(transport).sendPasswordReset('user@example.com', 'tok123', '30 minutes');

    expect(result).toEqual({ delivered: true, id: 'msg_1' });
    const [msg] = transport.sent;
    expect(msg.to).toBe('user@example.com');
    expect(msg.subject).toContain('Reset your');
    expect(msg.html).toContain('https://lifecapitalos.com/reset-password?email=user%40example.com&amp;token=tok123');
    expect(msg.text).toContain('https://lifecapitalos.com/reset-password?email=user%40example.com&token=tok123');
    expect(msg.text).toContain('30 minutes');
  });

  it('reports a failed delivery instead of throwing', async () => {
    const transport = new RecordingTransport({ delivered: false, error: 'resend_http_403' });
    await expect(service(transport).sendPasswordReset('u@e.com', 't', '30 minutes')).resolves.toEqual({
      delivered: false,
      error: 'resend_http_403',
    });
  });

  it('survives a transport that throws — the auth flow must not 500', async () => {
    await expect(service(new ThrowingTransport()).sendPasswordReset('u@e.com', 't', '30 minutes')).resolves.toEqual({
      delivered: false,
      error: 'transport_threw',
    });
  });

  it('reports whether a real provider is configured', () => {
    expect(service(new RecordingTransport()).isConfigured).toBe(true);
    expect(service({ name: 'console', send: async () => ({ delivered: true }) }).isConfigured).toBe(false);
  });

  it('tolerates a trailing slash on the configured app URL', async () => {
    const transport = new RecordingTransport();
    await service(transport, 'https://lifecapitalos.com/').sendEmailVerification('u@e.com', 't', '24 hours');
    expect(transport.sent[0]?.text).toContain('https://lifecapitalos.com/verify-email?');
    expect(transport.sent[0]?.text).not.toContain('.com//verify-email');
  });
});

describe('email templates', () => {
  it('neutralises markup in an address — no raw tag survives into the HTML', () => {
    // The address reaches the body only inside the link, so percent-encoding is the
    // defence there; escapeHtml (tested below) covers any value rendered as text.
    const rendered = passwordResetEmail({
      appUrl: 'https://app.test',
      email: '"><img src=x onerror=alert(1)>@evil.com',
      token: 'tok',
      expiresIn: '30 minutes',
    });
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).not.toContain('onerror=');
    expect(rendered.html).toContain('%3Cimg%20src%3Dx');
  });

  it('URL-encodes the email so it cannot break out of the query string', () => {
    const rendered = emailVerificationEmail({
      appUrl: 'https://app.test',
      email: 'a+b@example.com',
      token: 'tok&admin=1',
      expiresIn: '24 hours',
    });
    expect(rendered.text).toContain('email=a%2Bb%40example.com&token=tok%26admin%3D1');
  });

  it('always produces a plain-text alternative alongside the HTML', () => {
    const rendered = passwordResetEmail({
      appUrl: 'https://app.test',
      email: 'u@e.com',
      token: 'tok',
      expiresIn: '30 minutes',
    });
    expect(rendered.text.length).toBeGreaterThan(0);
    expect(rendered.text).not.toContain('<');
    expect(rendered.subject).toBeTruthy();
  });

  it('escapeHtml covers the five significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
