/** Plain HTML + text templates. No user-supplied HTML is ever interpolated raw. */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '</head><body style="margin:0;background:#f3f4f6;font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#111827">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 16px">',
    '<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">',
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>`,
    bodyHtml,
    '</div>',
    '<p style="color:#6b7280;font-size:12px;margin-top:16px">AI Notetaker — this message was sent automatically.</p>',
    '</div></body></html>',
  ].join('');
}

export interface MagicLinkTemplate {
  subject: string;
  html: string;
  text: string;
}

export function magicLinkEmail(url: string, ttlMinutes: number): MagicLinkTemplate {
  const safe = escapeHtml(url);
  return {
    subject: 'Sign in to AI Notetaker',
    html: layout(
      'Sign in to AI Notetaker',
      `<p>Use the button below to sign in. This link expires in ${ttlMinutes} minutes and can only be used once.</p>` +
        `<p><a href="${safe}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Sign in</a></p>` +
        `<p style="word-break:break-all;font-size:12px;color:#6b7280">Or open: ${safe}</p>` +
        '<p style="font-size:12px;color:#6b7280">If you did not request this, you can safely ignore this email.</p>',
    ),
    text: `Sign in to AI Notetaker:\n\n${url}\n\nThis link expires in ${ttlMinutes} minutes and is single-use.\nIf you did not request this, ignore this email.`,
  };
}

export function otpEmail(code: string, ttlMinutes: number): MagicLinkTemplate {
  return {
    subject: 'Your AI Notetaker sign-in code',
    html: layout(
      'Your sign-in code',
      `<p>Enter this 6-digit code to sign in. It expires in ${ttlMinutes} minutes.</p>` +
        `<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:24px 0">${escapeHtml(code)}</p>` +
        '<p style="font-size:12px;color:#6b7280">If you did not request this, you can safely ignore this email.</p>',
    ),
    text: `Your AI Notetaker sign-in code is ${code}\n\nIt expires in ${ttlMinutes} minutes.\nIf you did not request this, ignore this email.`,
  };
}

export function resultEmail(noteTitle: string, noteUrl: string): MagicLinkTemplate {
  const safe = escapeHtml(noteUrl);
  return {
    subject: `Your notes are ready: ${noteTitle}`,
    html: layout(
      'Your notes are ready',
      `<p>Processing finished for <strong>${escapeHtml(noteTitle)}</strong>. Your transcript, executive summary, action items and mind map are ready.</p>` +
        `<p><a href="${safe}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Open notes</a></p>` +
        `<p style="word-break:break-all;font-size:12px;color:#6b7280">Or open: ${safe}</p>`,
    ),
    text: `Processing finished for "${noteTitle}".\n\nOpen your notes: ${noteUrl}`,
  };
}

export function failureEmail(noteTitle: string, noteUrl: string, reason: string): MagicLinkTemplate {
  const safe = escapeHtml(noteUrl);
  return {
    subject: `Processing failed: ${noteTitle}`,
    html: layout(
      'Processing failed',
      `<p>We could not finish processing <strong>${escapeHtml(noteTitle)}</strong>.</p>` +
        `<p>Reason: ${escapeHtml(reason)}</p>` +
        `<p><a href="${safe}" style="color:#4f46e5">View details</a></p>`,
    ),
    text: `Processing failed for "${noteTitle}".\n\nReason: ${reason}\n\nDetails: ${noteUrl}`,
  };
}

export function testEmail(): MagicLinkTemplate {
  return {
    subject: 'AI Notetaker test email',
    html: layout('Test email', '<p>Your Resend configuration is working correctly.</p>'),
    text: 'Your Resend configuration is working correctly.',
  };
}
