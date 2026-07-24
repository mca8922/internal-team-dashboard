/**
 * One-off: send sample emails so we can eyeball the branded, theme-aware HTML
 * shell for every TRANSACTIONAL type (goal assigned, leave decided, missed
 * punch-out). Uses the REAL templates and the same SMTP transport the app
 * uses. Sample copy (no AI call), so what we're previewing is the design,
 * not the wording.
 *
 * Run:  npx tsx scripts/send-test-email.ts
 */
import { config } from 'dotenv';
import nodemailer from 'nodemailer';
import { renderTransactionalEmail, transactionalPlainText } from '../src/lib/email-shell';

config({ path: '.env.local' });

const TO = 'nishitrathod27@gmail.com';
const DASH_FROM = '"reStrucAI Dashboard" <sales@restrucai.com>';
const APP_URL = 'https://restrucai-team.vercel.app';
const NAME = 'Aarav';

// --- Transactional samples (branded frame, greeting, CTA, no-reply footer) ---
const transactional = [
  {
    from: DASH_FROM,
    title: 'New goal assigned to you',
    body: 'Launch Q3 brand campaign',
    ctaUrl: `${APP_URL}/goals`,
  },
  {
    from: DASH_FROM,
    title: 'Your leave was approved',
    body: 'CASUAL · 2026-06-15 - 2026-06-17 · "Enjoy your trip"',
    ctaUrl: `${APP_URL}/leaves`,
  },
  {
    from: DASH_FROM,
    title: 'You forgot to punch out',
    body: 'Your session from Monday, June 8, 2026 is still running. Please ask Nishit Rathod (Founder) to correct your punch - message them on WhatsApp.',
    ctaUrl: `${APP_URL}/punch?missed=2026-06-08`,
  },
];

async function main() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  for (const t of transactional) {
    const info = await transport.sendMail({
      from: t.from,
      to: TO,
      subject: t.title,
      html: renderTransactionalEmail({ name: NAME, title: t.title, body: t.body, ctaUrl: t.ctaUrl }),
      text: transactionalPlainText({ name: NAME, title: t.title, body: t.body, ctaUrl: t.ctaUrl }),
    });
    console.log(`Sent "${t.title}":`, info.messageId);
  }

  console.log(`\nAll sample emails sent to ${TO}.`);
}

main().catch((e) => {
  console.error('Failed to send:', e);
  process.exit(1);
});
