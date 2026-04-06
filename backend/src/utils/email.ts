import nodemailer from 'nodemailer';

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface SmtpTimeouts {
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
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

const parseSmtpTimeout = (raw: string | undefined, fallback: number): number => {
  const normalized = raw?.trim();
  const parsed = normalized ? Number(normalized) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120000) {
    return fallback;
  }

  return parsed;
};

const parseSmtpTimeouts = (): SmtpTimeouts => {
  const connectionTimeoutMs = parseSmtpTimeout(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10000);
  const greetingTimeoutMs = parseSmtpTimeout(process.env.SMTP_GREETING_TIMEOUT_MS, 10000);
  const socketTimeoutMs = parseSmtpTimeout(process.env.SMTP_SOCKET_TIMEOUT_MS, 15000);

  return {
    connectionTimeoutMs,
    greetingTimeoutMs,
    socketTimeoutMs,
  };
};

const normalizeSmtpPassword = (host: string, pass: string): string => {
  const isGmailHost = host.toLowerCase() === 'smtp.gmail.com';

  if (!isGmailHost) {
    return pass;
  }

  // Gmail App Passwords are displayed with spaces in UI; SMTP expects it without spaces.
  return pass.replace(/\s+/g, '');
};

const smtpTimeouts = parseSmtpTimeouts();
const smtpConfig = {
  host: process.env.SMTP_HOST?.trim() || '',
  port: parseSmtpPort(),
  secure: parseSmtpSecure(),
  user: process.env.SMTP_USER?.trim() || '',
  pass: process.env.SMTP_PASS?.trim() ?? '',
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
    connectionTimeout: smtpTimeouts.connectionTimeoutMs,
    greetingTimeout: smtpTimeouts.greetingTimeoutMs,
    socketTimeout: smtpTimeouts.socketTimeoutMs,
    auth: {
      user: smtpConfig.user,
      pass: normalizeSmtpPassword(smtpConfig.host, smtpConfig.pass),
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
