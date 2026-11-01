import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConnectorRpcHandler, HostContext, RpcResult, WebRoute } from '../host-api.js';
import { errorCode, errorMessage } from '../types.js';

const CHANNEL = '/dsh-connect';
const MAX_BODY_BYTES = 64 * 1024;

export type ConnectorHostContext = Pick<HostContext, 'webServer' | 'connection' | 'effect'>;

/**
 * Mount the P0 unary RPC using the current DSH webServer/connection services.
 * This preserves the standard Connection envelope and admission fence while
 * avoiding rpc.handle()'s service-owner webServer injection issue in 0.2.1-rc.3.
 */
export function registerConnectorRpc(ctx: ConnectorHostContext, handler: ConnectorRpcHandler): () => void {
  const route: WebRoute = {
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      const admission = ctx.connection.admit(req);
      if ('rejection' in admission) {
        res.writeHead(admission.rejection);
        res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const endpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : '';
      if (req.method !== 'POST' || !endpoint) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        res.writeHead(415);
        res.end('content type must be application/json');
        return;
      }

      let message: unknown;
      try {
        const body = await readBody(req);
        message = JSON.parse(body);
      } catch (error) {
        res.writeHead(errorCode(error) === 'payload_too_large' ? 413 : 400);
        res.end(errorMessage(error, String(error)));
        return;
      }
      if (!isClientRequest(message) || message.method !== endpoint) {
        res.writeHead(400);
        res.end('invalid Connection client-request');
        return;
      }

      const controller = new AbortController();
      if (req.aborted) controller.abort();
      req.once('aborted', () => controller.abort());
      try {
        const result = await handler(endpoint, message.payload, controller.signal, admission.peer);
        sendJson(res, 200, { type: 'server-response', rpcId: message.rpcId, result });
      } catch (error) {
        sendJson(res, 200, {
          type: 'server-response',
          rpcId: message.rpcId,
          result: failure(errorCode(error, 'gateway/internal'), errorMessage(error, String(error))),
        });
      }
    },
  };
  const dispose = ctx.webServer.register(route);
  ctx.effect(() => dispose, 'dsh-connect: unary RPC route');
  return dispose;
}

function isClientRequest(value: unknown): value is { type: 'client-request'; rpcId: string; method: string; payload?: unknown } {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'client-request'
    && typeof (value as { rpcId?: unknown }).rpcId === 'string'
    && typeof (value as { method?: unknown }).method === 'string';
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('RPC payload exceeds 64 KiB') as Error & { code: string };
      error.code = 'payload_too_large';
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } };
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
