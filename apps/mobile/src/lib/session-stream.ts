import { Platform } from 'react-native';

import { normalizeServerUrl } from '@/lib/mobile-api';

export type SessionStreamHandlers = {
  onOpen: () => void;
  onClose: () => void;
  onStart: () => void;
  onDelta: (text: string) => void;
  onEnd: () => void;
  onRefresh: () => void;
  onError: (message: string) => void;
};

export type SessionStreamOptions = {
  serverUrl: string;
  accessToken: string;
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  cursor?: string;
};

type Frame = Record<string, unknown>;

/** Convert the HTTP(S) Server URL into the mobile event socket URL. */
export function buildSessionStreamUrl(options: SessionStreamOptions): string {
  const url = new URL(normalizeServerUrl(options.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = url.pathname.replace(/\/+$/, '');
  url.pathname = `${base}/v1/mobile/events/ws`;
  const query = new URLSearchParams({
    deviceId: options.deviceId,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
  });
  if (options.cursor) query.set('cursor', options.cursor);
  // Browsers cannot set an Authorization header on a WebSocket handshake.
  if (Platform.OS === 'web') query.set('accessToken', options.accessToken);
  url.search = query.toString();
  return url.toString();
}

/**
 * Opens the live assistant stream for one granted session. The caller owns
 * reconnect/backoff and must call `close()` when the screen or turn ends.
 */
export function openSessionStream(
  options: SessionStreamOptions,
  handlers: SessionStreamHandlers,
): { close: () => void } {
  const url = buildSessionStreamUrl(options);
  let closed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingText = '';

  const RNWebSocket = WebSocket as unknown as new (
    target: string,
    protocols?: string | string[],
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  const socket = new RNWebSocket(
    url,
    undefined,
    Platform.OS === 'web'
      ? undefined
      : { headers: { Authorization: `Bearer ${options.accessToken}` } },
  );

  const flush = () => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (pendingText.length === 0) return;
    const text = pendingText;
    pendingText = '';
    handlers.onDelta(text);
  };

  const queue = (text: string) => {
    pendingText += text;
    if (flushTimer === undefined) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        if (!closed) flush();
      }, 40);
    }
  };

  const refreshSoon = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (!closed) handlers.onRefresh();
    }, 150);
  };

  socket.onopen = () => {
    if (!closed) handlers.onOpen();
  };

  socket.onmessage = (event) => {
    if (closed) return;
    const frame = parseFrame(event.data);
    if (!frame) return;
    if (frame.type === 'error') {
      const error = isRecord(frame.error) ? frame.error : {};
      handlers.onError(typeof error.message === 'string' ? error.message : '实时连接返回错误。');
      return;
    }
    if (frame.type !== 'event') return;
    const kind = frame.kind;
    const data = isRecord(frame.data) ? frame.data : {};
    if (kind === 'assistant.stream') {
      if (typeof data.phase === 'string') {
        switch (data.phase) {
          case 'start':
            handlers.onStart();
            return;
          case 'delta':
            if (typeof data.text === 'string' && data.text.length > 0) queue(data.text);
            return;
          case 'end':
            flush();
            handlers.onEnd();
            return;
          default:
            return;
        }
      }
      // Compatibility with Connectors that still forward the DSH wire frame.
      if (data.type === 'start') {
        handlers.onStart();
      } else if (data.type === 'end') {
        flush();
        handlers.onEnd();
      } else if (data.type === 'chunk' && isRecord(data.chunk)) {
        if (data.chunk.type === 'text-delta' && typeof data.chunk.text === 'string') {
          queue(data.chunk.text);
        }
      }
      return;
    }
    if (kind === 'connector.error') {
      handlers.onError(typeof data.message === 'string' ? data.message : '桌面 Connector 报错。');
      return;
    }
    if (kind === 'session.resync_required') {
      handlers.onRefresh();
      return;
    }
    if (kind === 'session.event') {
      const eventType = data.type;
      if (eventType === 'assistant/message' || eventType === 'user/message' || eventType === 'turn/end') {
        refreshSoon();
      }
    }
  };

  socket.onerror = () => {
    if (!closed) handlers.onError('实时连接失败，已回退到轮询。');
  };

  socket.onclose = () => {
    flush();
    if (!closed) handlers.onClose();
  };

  return {
    close: () => {
      closed = true;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      refreshTimer = undefined;
      flushTimer = undefined;
      pendingText = '';
      try {
        socket.close();
      } catch {
        // Closing an already-closed socket is harmless.
      }
    },
  };
}

function parseFrame(value: unknown): Frame | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
