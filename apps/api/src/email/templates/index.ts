import { renderLayout, type RenderedEmail } from './layout';

/**
 * Builds an app URL with the one-time secret in the query string.
 *
 * `encodeURIComponent` is not optional here: reset tokens are hex so they are safe, but the
 * email is user-controlled and could otherwise break out of the query string.
 */
function link(appUrl: string, path: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${appUrl.replace(/\/+$/, '')}${path}?${qs}`;
}

export function passwordResetEmail(input: { appUrl: string; email: string; token: string; expiresIn: string }): RenderedEmail {
  const url = link(input.appUrl, '/reset-password', { email: input.email, token: input.token });
  const { html, text } = renderLayout({
    heading: 'Reset your password',
    paragraphs: [
      'We received a request to reset the password for your Life Capital OS account.',
      'Choose a new password using the button below.',
    ],
    cta: { label: 'Set a new password', url },
    footnotes: [
      `This link expires in ${input.expiresIn} and can only be used once.`,
      "If you didn't request this, you can safely ignore this email — your password will not change.",
      `If the button doesn't work, paste this into your browser: ${url}`,
    ],
  });
  return { subject: 'Reset your Life Capital OS password', html, text };
}

export function emailVerificationEmail(input: { appUrl: string; email: string; token: string; expiresIn: string }): RenderedEmail {
  const url = link(input.appUrl, '/verify-email', { email: input.email, token: input.token });
  const { html, text } = renderLayout({
    heading: 'Confirm your email address',
    paragraphs: [
      'Welcome to Life Capital OS.',
      'Confirm this email address so we can reach you about your account and send password resets.',
    ],
    cta: { label: 'Confirm my email', url },
    footnotes: [
      `This link expires in ${input.expiresIn}.`,
      "If you didn't create a Life Capital OS account, you can ignore this email.",
      `If the button doesn't work, paste this into your browser: ${url}`,
    ],
  });
  return { subject: 'Confirm your email address', html, text };
}

export type { RenderedEmail };
