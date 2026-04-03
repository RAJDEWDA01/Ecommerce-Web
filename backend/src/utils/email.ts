import nodemailer from 'nodemailer';

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const parseSmtpPort = (): number => {
  const raw = process.env.SMTP_PORT?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 587;
  }

  return parsed;
};

const parseSmtpSecure = (): boolean => {
  const raw = process.env.SMTP_SECURE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
};

const smtpConfig = {
  host: process.env.SMTP_HOST?.trim() || '',
  port: parseSmtpPort(),
  secure: parseSmtpSecure(),
  user: process.env.SMTP_USER?.trim() || '',
  pass: process.env.SMTP_PASS ?? '',
  from: process.env.SMTP_FROM?.trim() || 'Gaumaya Farm <no-reply@gaumaya.local>',
};

const isSmtpConfigured = (): boolean =>
  Boolean(smtpConfig.host && smtpConfig.user && smtpConfig.pass);

export const sendEmail = async ({ to, subject, text, html }: SendEmailInput): Promise<boolean> => {
  if (!isSmtpConfigured()) {
    console.warn(
      `Email service is not configured. Intended email to ${to}: ${subject}\n${text}`
    );
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
  });

  await transporter.sendMail({
    from: smtpConfig.from,
    to,
    subject,
    text,
    html,
  });

  return true;
};
