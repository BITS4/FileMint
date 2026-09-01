import type { Context } from 'hono';
import type { CodePurpose } from './auth.models';
import { logger } from './observability';

function isProductionLike(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.FILEMINT_PRODUCTION === 'true';
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

export function appBaseUrl(c: Context): string {
  const configured = process.env.FILEMINT_PUBLIC_URL || process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
      return url.toString().replace(/\/+$/, '');
    } catch {
      throw new Error('FILEMINT_PUBLIC_URL must be a valid HTTP(S) URL.');
    }
  }
  if (isProductionLike()) throw new Error('FILEMINT_PUBLIC_URL is required in production.');
  const origin = c.req.header('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      if (['http:', 'https:'].includes(url.protocol)) return url.toString().replace(/\/+$/, '');
    } catch {
      // Ignore malformed development origins and use the local host fallback.
    }
  }
  const host = c.req.header('host') || `localhost:${process.env.PORT ?? 8787}`;
  const forwardedProto = c.req.header('x-forwarded-proto');
  const proto = ['http', 'https'].includes(forwardedProto ?? '')
    ? forwardedProto
    : host.includes('localhost')
      ? 'http'
      : 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function buildVerifyUrl(c: Context, email: string, code: string): string {
  const params = new URLSearchParams({ email, code });
  return `${appBaseUrl(c)}/auth/verify?${params.toString()}`;
}

export async function deliverAuthCode(
  c: Context,
  options: { email: string; code: string; purpose: CodePurpose; fullName?: string | null },
): Promise<{ sent: boolean; devCode?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FILEMINT_EMAIL_FROM || process.env.RESEND_FROM;
  const isVerify = options.purpose === 'verify_email';
  let verifyUrl: string | null = null;
  if (isVerify && apiKey && from) {
    try {
      verifyUrl = buildVerifyUrl(c, options.email, options.code);
    } catch (error) {
      return {
        sent: false,
        error: error instanceof Error ? error.message : 'Invalid public application URL.',
      };
    }
  }
  const title = isVerify ? 'Verify your FileMint email' : 'Reset your FileMint password';
  const intro = isVerify
    ? 'Use this code to verify your FileMint account.'
    : 'Use this code to reset your FileMint password.';
  const name = options.fullName ? ` ${escapeHtml(options.fullName)}` : '';

  if (apiKey && from) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
        <h1 style="font-size:24px;margin:0 0 16px">FileMint</h1>
        <p>Hello${name},</p>
        <p>${intro}</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f3f4f6;border-radius:12px;padding:18px 24px;text-align:center">${options.code}</div>
        ${verifyUrl ? `<p style="margin-top:24px"><a href="${escapeHtml(verifyUrl)}" style="background:#10b981;color:#ffffff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a></p>` : ''}
        <p style="color:#6b7280;font-size:13px">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
      </div>`;
    const text = `${title}\n\n${intro}\n\nCode: ${options.code}${verifyUrl ? `\n\nVerify: ${verifyUrl}` : ''}\n\nThis code expires in 10 minutes.`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [options.email], subject: title, html, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          sent: false,
          error: `Email provider rejected the message (${res.status}). ${body.slice(0, 240)}`.trim(),
        };
      }
      return { sent: true };
    } catch (error) {
      return {
        sent: false,
        error: error instanceof Error ? error.message : 'Email provider request failed.',
      };
    }
  }

  if (isProductionLike()) {
    return {
      sent: false,
      error: 'Email delivery is not configured. Set RESEND_API_KEY and FILEMINT_EMAIL_FROM before deploying.',
    };
  }

  logger.info({ purpose: options.purpose, delivery: 'development' }, 'Generated local authentication code');
  return { sent: false, devCode: options.code };
}
