export interface CollaboraMessage {
  MessageId: string;
  Values?: Record<string, unknown>;
}

export interface CollaboraLaunch {
  action: string;
  accessToken: string;
  accessTokenTtl: string;
  origin: string;
}

export function parseCollaboraMessage(data: unknown): CollaboraMessage | null {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.MessageId !== 'string' || !candidate.MessageId.trim()) return null;
    const values = candidate.Values;
    if (values !== undefined && (!values || typeof values !== 'object' || Array.isArray(values))) return null;
    return {
      MessageId: candidate.MessageId,
      ...(values ? { Values: values as Record<string, unknown> } : {}),
    };
  } catch {
    return null;
  }
}

export function collaboraBooleanValue(
  values: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = values?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

export function parseCollaboraLaunch(value: string): CollaboraLaunch | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const accessToken = url.searchParams.get('access_token') ?? '';
    const rawTtl = url.searchParams.get('access_token_ttl') ?? '0';
    const accessTokenTtl = /^\d+$/.test(rawTtl) ? rawTtl : '0';
    url.searchParams.delete('access_token');
    url.searchParams.delete('access_token_ttl');
    return { action: url.toString(), accessToken, accessTokenTtl, origin: url.origin };
  } catch {
    return null;
  }
}
