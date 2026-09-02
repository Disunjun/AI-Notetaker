import { decryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * Resend transport.
 *
 * The API key is stored encrypted in PostgreSQL and is never read from the
 * environment. Admin authentication does not depend on this module.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15_000;

export interface ResendSettings {
  id: string;
  apiKey: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  isActive: boolean;
}

export async function loadResendSettings(): Promise<ResendSettings | null> {
  const row = (await prisma.resendConfig.findFirst({ where: { isActive: true } })) as unknown as {
    id: string;
    apiKeyEncrypted: string;
    fromEmail: string;
    fromName: string | null;
    replyTo: string | null;
  } | null;
  if (!row) return null;

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.apiKeyEncrypted);
  } catch {
    throw new AppError(ErrorCode.EMAIL_NOT_CONFIGURED, 'Stored Resend API key could not be decrypted');
  }
  return {
    id: row.id,
    apiKey,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyTo: row.replyTo,
    isActive: true,
  };
}

export interface ResendMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface ResendResult {
  id: string | null;
}

export async function sendViaResend(settings: ResendSettings, message: ResendMessage): Promise<ResendResult> {
  const from = settings.fromName ? `${settings.fromName} <${settings.fromEmail}>` : settings.fromEmail;
  const body = {
    from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
  };

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      // The key lives only in this header; it is never logged.
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(ErrorCode.EMAIL_SEND_FAILED, 'Could not reach the email provider', {
      cause: error,
      safe: false,
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(ErrorCode.EMAIL_SEND_FAILED, `Email provider returned HTTP ${response.status}`, { safe: false });
  }
  let id: string | null = null;
  try {
    id = (JSON.parse(text) as { id?: string }).id ?? null;
  } catch {
    id = null;
  }
  return { id };
}
