// Brand-styled HTML shell for Mahesh Chandra & Associates transactional emails
// (system notices: goal assigned, leave decided, missed punch-out). Greeting +
// headline + CTA button + an automated / no-reply footer.
//
// Light / dark aware via `prefers-color-scheme` so the email matches the theme
// of the device it is opened on. Every colour is set inline (for clients that
// ignore <style>) AND given a class, so the dark-mode media query can override
// it with !important. The wordmark text flips dark<->light so it stays
// legible on either background.
//
// Pure string rendering with no secrets, so it is intentionally NOT
// `server-only` — the email-preview/test script imports it directly.

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const THEME_STYLE = `<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:0; }
  a { text-decoration:none; }
  .rt-bg { background:#f4f5f7; }
  .rt-card { background:#ffffff; border-color:#e9eaee; }
  .rt-text { color:#1f2329; }
  .rt-heading { color:#15181d; }
  .rt-divider { border-top-color:#e9eaee; }
  .rt-black { color:#1a1a1a; }
  .rt-green { color:#16a34a; }
  .rt-btn { background:#16a34a; }
  .rt-btn a { color:#ffffff !important; }
  .rt-tagline { color:#8a909a; }
  .rt-note { color:#9aa3af; }
  @media (prefers-color-scheme: dark) {
    .rt-bg { background:#0b0d10 !important; }
    .rt-card { background:#16191e !important; border-color:#262b32 !important; }
    .rt-text { color:#e9ebee !important; }
    .rt-heading { color:#f3f4f6 !important; }
    .rt-divider { border-top-color:#262b32 !important; }
    .rt-black { color:#f3f4f6 !important; }
    .rt-green { color:#22c55e !important; }
    .rt-btn { background:#22c55e !important; }
    .rt-btn a { color:#06150b !important; }
    .rt-tagline { color:#7d838d !important; }
    .rt-note { color:#6b7280 !important; }
  }
</style>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Detail / letter text -> safe HTML paragraphs. Escapes first (a goal title,
// review note, or AI-generated body must never inject markup), then keeps
// light **bold** and turns blank lines into paragraphs / single newlines <br>.
function bodyBlocks(body: string): string[] {
  return escapeHtml(body)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p class="rt-text" style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#1f2329">${p.replace(/\n/g, '<br>')}</p>`,
    );
}

function bodyToHtml(body: string): string {
  return bodyBlocks(body).join('');
}

// The Mahesh Chandra & Associates wordmark. `size` drives header (larger) vs
// footer (smaller).
function wordmark(size: number): string {
  return (
    `<span class="rt-black" style="font-family:${FONT};font-size:${size}px;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a">` +
    `Mahesh Chandra &amp; Associates` +
    `</span>`
  );
}

// Footer wordmark + tagline, with an optional automated / no-reply line.
function footer(noReply: boolean): string {
  const note = noReply
    ? `<div class="rt-note" style="margin-top:16px;font-family:${FONT};font-size:11px;line-height:1.6;color:#9aa3af">
                  This is an automated message from the Mahesh Chandra & Associates Dashboard.<br>Please do not reply to this email.
                </div>`
    : '';
  return `<tr>
            <td align="center" style="padding:28px 8px 0 8px">
              <div class="rt-divider" style="border-top:1px solid #e9eaee;padding-top:26px">
                ${wordmark(28)}
                <div class="rt-tagline" style="margin-top:6px;font-family:${FONT};font-size:12px;letter-spacing:0.2px;color:#8a909a">Chartered Accountants</div>
                ${note}
              </div>
            </td>
          </tr>`;
}

// Wraps the card inner HTML in the full document + brand header + footer.
function document(cardInner: string, opts: { noReply: boolean }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
${THEME_STYLE}
</head>
<body class="rt-bg" style="margin:0;padding:0;background:#f4f5f7">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rt-bg" style="background:#f4f5f7">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
          <tr>
            <td class="rt-card" style="background:#ffffff;border:1px solid #e9eaee;border-radius:14px;padding:32px">
              ${cardInner}
            </td>
          </tr>
          ${footer(opts.noReply)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface TransactionalEmailParts {
  name: string; // recipient name (only the first word is used in the greeting)
  title: string; // headline (already sanitized upstream)
  body: string; // detail line(s) (already sanitized upstream)
  ctaUrl: string; // app-controlled dashboard deep link
  ctaLabel?: string;
}

export function renderTransactionalEmail(parts: TransactionalEmailParts): string {
  const greet = escapeHtml(parts.name.split(' ')[0] || 'there');
  const title = escapeHtml(parts.title);
  const bodyHtml = bodyToHtml(parts.body);
  const ctaLabel = escapeHtml(parts.ctaLabel ?? 'Open the dashboard');
  const ctaUrl = parts.ctaUrl;

  const cardInner = `<p class="rt-text" style="margin:0 0 16px 0;font-size:15px;line-height:1.7;color:#1f2329">Hi ${greet},</p>
              <h1 class="rt-heading" style="margin:0 0 14px 0;font-size:19px;font-weight:700;line-height:1.4;color:#15181d">${title}</h1>
              ${bodyHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px 0">
                <tr>
                  <td class="rt-btn" style="background:#16a34a;border-radius:8px">
                    <a href="${ctaUrl}" style="display:inline-block;padding:11px 24px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;border-radius:8px">${ctaLabel}</a>
                  </td>
                </tr>
              </table>`;
  return document(cardInner, { noReply: true });
}

// Plain-text fallback for transactional emails.
export function transactionalPlainText(parts: TransactionalEmailParts): string {
  const greet = parts.name.split(' ')[0] || 'there';
  const lines = [
    `Hi ${greet},`,
    '',
    parts.title,
    ...(parts.body ? ['', parts.body] : []),
    '',
    `${parts.ctaLabel ?? 'Open the dashboard'}: ${parts.ctaUrl}`,
    '',
    '----',
    'Mahesh Chandra & Associates - Chartered Accountants',
    'This is an automated message. Please do not reply to this email.',
  ];
  return lines.join('\n');
}
