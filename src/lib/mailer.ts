import 'server-only';
import nodemailer from 'nodemailer';

function createTransport() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Port 465 = implicit SSL (secure:true), port 587 = STARTTLS (secure:false)
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  // Optional plain-text alternative. Including it improves deliverability and
  // gives a fallback for clients that do not render HTML.
  text?: string;
  from?: string;
  bcc?: string | false;
}

export async function sendMail(opts: MailOptions): Promise<string | null> {
  const transport = createTransport();
  const info = await transport.sendMail({
    from: opts.from ?? '"Mahesh Chandra & Associates Dashboard" <sales@restrucai.com>',
    to: opts.to,
    ...(opts.bcc ? { bcc: opts.bcc } : {}),
    subject: opts.subject,
    html: opts.html,
    ...(opts.text ? { text: opts.text } : {}),
  });
  return info.messageId ?? null;
}
