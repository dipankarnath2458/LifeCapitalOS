/**
 * Shared email chrome. Pure functions — no config, no I/O — so templates are trivially
 * testable and cannot leak anything the caller did not pass in.
 *
 * Email clients strip <style> blocks and ignore most modern CSS, so everything here is
 * inline and table-free-but-simple. Brand colour matches the web app's `brand` token.
 */

const BRAND = '#0f766e';
const TEXT = '#0f172a';
const SUBTLE = '#475569';
const BORDER = '#e2e8f0';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escapes text destined for an HTML body. Tokens and emails are attacker-influenced. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LayoutOptions {
  heading: string;
  /** Body paragraphs, plain text. Escaped before insertion. */
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** Small print under the button (e.g. the expiry note and the raw link). */
  footnotes?: string[];
}

export function renderLayout(opts: LayoutOptions): { html: string; text: string } {
  const paragraphs = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT};">${escapeHtml(p)}</p>`)
    .join('');

  const cta = opts.cta
    ? `<p style="margin:24px 0;">
         <a href="${escapeHtml(opts.cta.url)}"
            style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
                   padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">
           ${escapeHtml(opts.cta.label)}
         </a>
       </p>`
    : '';

  const footnotes = (opts.footnotes ?? [])
    .map((f) => `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${SUBTLE};">${escapeHtml(f)}</p>`)
    .join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;padding:32px;">
      <p style="margin:0 0 24px;font-size:16px;font-weight:700;color:${BRAND};">Life Capital OS</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${TEXT};">${escapeHtml(opts.heading)}</h1>
      ${paragraphs}
      ${cta}
      ${footnotes}
    </div>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:${SUBTLE};text-align:center;">
      Life Capital OS · This is an automated message, please do not reply.
    </p>
  </body>
</html>`;

  const text = [
    'Life Capital OS',
    '',
    opts.heading,
    '',
    ...opts.paragraphs,
    ...(opts.cta ? ['', `${opts.cta.label}: ${opts.cta.url}`] : []),
    ...(opts.footnotes?.length ? ['', ...opts.footnotes] : []),
    '',
    'This is an automated message, please do not reply.',
  ].join('\n');

  return { html, text };
}
