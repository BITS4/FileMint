import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

export interface CollaboraEditorHandle {
  /** Ask Collabora to persist the document (WOPI PutFile) via postMessage. */
  save: () => Promise<CollaboraSaveResult>;
}

export interface CollaboraEditorProps {
  url: string;
}

export interface CollaboraSaveResult {
  confirmed: boolean;
  hadEdits: boolean;
}

interface CollaboraMessage {
  MessageId?: string;
  Values?: Record<string, unknown>;
}

interface PendingSave {
  hadEdits: boolean;
  resolve: (result: CollaboraSaveResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

function parseMessage(data: unknown): CollaboraMessage | null {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!parsed || typeof parsed !== 'object') return null;
    const msg = parsed as CollaboraMessage;
    return typeof msg.MessageId === 'string' ? msg : null;
  } catch {
    return null;
  }
}

function booleanValue(values: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = values?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return undefined;
}

export const CollaboraEditor = forwardRef<CollaboraEditorHandle, CollaboraEditorProps>(({ url }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const hadEditsRef = useRef(false);
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const iframeName = useMemo(() => `filemint-collabora-${Math.random().toString(36).slice(2)}`, []);

  const launch = useMemo(() => {
    try {
      const parsed = new URL(url);
      const accessToken = parsed.searchParams.get('access_token') ?? '';
      const accessTokenTtl = parsed.searchParams.get('access_token_ttl') ?? '0';
      parsed.searchParams.delete('access_token');
      parsed.searchParams.delete('access_token_ttl');
      return { action: parsed.toString(), accessToken, accessTokenTtl };
    } catch {
      return { action: url, accessToken: '', accessTokenTtl: '0' };
    }
  }, [url]);

  const targetOrigin = useMemo(() => {
    try {
      return new URL(launch.action).origin;
    } catch {
      return '*';
    }
  }, [launch.action]);

  const post = useCallback(
    (message: CollaboraMessage) => {
      const frame = iframeRef.current?.contentWindow;
      if (!frame) return false;
      frame.postMessage(
        JSON.stringify({
          SendTime: Date.now(),
          Values: {},
          ...message,
        }),
        targetOrigin,
      );
      return true;
    },
    [targetOrigin],
  );

  const announceReady = useCallback(() => post({ MessageId: 'Host_PostmessageReady' }), [post]);

  const finishSave = useCallback((confirmed: boolean) => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSaveRef.current = null;
    const hadEdits = pending.hadEdits || hadEditsRef.current;
    if (confirmed) hadEditsRef.current = false;
    pending.resolve({ confirmed, hadEdits });
  }, []);

  useEffect(() => {
    const pending = pendingSaveRef.current;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ confirmed: false, hadEdits: pending.hadEdits || hadEditsRef.current });
    }
    readyRef.current = false;
    hadEditsRef.current = false;
    pendingSaveRef.current = null;
  }, [url]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = launch.action;
    form.target = iframeName;
    form.style.display = 'none';

    const token = document.createElement('input');
    token.type = 'hidden';
    token.name = 'access_token';
    token.value = launch.accessToken;
    form.appendChild(token);

    const ttl = document.createElement('input');
    ttl.type = 'hidden';
    ttl.name = 'access_token_ttl';
    ttl.value = launch.accessTokenTtl;
    form.appendChild(ttl);

    document.body.appendChild(form);
    form.submit();
    form.remove();
  }, [iframeName, launch]);

  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve({ confirmed: false, hadEdits: pending.hadEdits || hadEditsRef.current });
        pendingSaveRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (targetOrigin !== '*' && event.origin !== targetOrigin) return;
      const msg = parseMessage(event.data);
      if (!msg?.MessageId) return;

      const values = msg.Values;
      if (msg.MessageId === 'App_LoadingStatus') {
        announceReady();
        if (!values?.Status || values.Status === 'Document_Loaded') {
          readyRef.current = true;
        }
        return;
      }

      if (msg.MessageId === 'Doc_ModifiedStatus') {
        const modified = booleanValue(values, 'Modified');
        if (modified) {
          hadEditsRef.current = true;
        } else if (!pendingSaveRef.current) {
          hadEditsRef.current = false;
        }
        return;
      }

      if (msg.MessageId === 'Action_Save_Resp') {
        const success = booleanValue(values, 'success') ?? booleanValue(values, 'Success') ?? true;
        finishSave(success);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [announceReady, finishSave, targetOrigin]);

  useImperativeHandle(
    ref,
    () => ({
      save: () =>
        new Promise<CollaboraSaveResult>((resolve) => {
          const existing = pendingSaveRef.current;
          if (existing) {
            clearTimeout(existing.timer);
            existing.resolve({ confirmed: false, hadEdits: existing.hadEdits || hadEditsRef.current });
          }

          const timer = setTimeout(() => {
            const pending = pendingSaveRef.current;
            pendingSaveRef.current = null;
            resolve({ confirmed: false, hadEdits: pending?.hadEdits || hadEditsRef.current });
          }, 12000);
          pendingSaveRef.current = { resolve, timer, hadEdits: hadEditsRef.current };

          const sendSave = () => {
            announceReady();
            const sent = post({
              MessageId: 'Action_Save',
              Values: { Notify: true, DontTerminateEdit: true, DontSaveIfUnmodified: false },
            });
            if (!sent) finishSave(false);
          };

          if (readyRef.current) {
            sendSave();
          } else {
            announceReady();
            setTimeout(sendSave, 300);
          }
        }),
    }),
    [announceReady, finishSave, post],
  );

  return (
    <iframe
      ref={iframeRef}
      name={iframeName}
      src="about:blank"
      title="Document editor"
      style={{ border: 'none', width: '100%', height: '100%', background: '#fff' }}
      allow="clipboard-read; clipboard-write"
      onLoad={() => {
        announceReady();
        setTimeout(announceReady, 500);
      }}
    />
  );
});

CollaboraEditor.displayName = 'CollaboraEditor';
