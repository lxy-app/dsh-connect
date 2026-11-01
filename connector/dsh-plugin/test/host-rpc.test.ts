import assert from 'node:assert/strict';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import type {
  ConnectorHostContext,
} from '../src/lib/host-rpc.js';
import { registerConnectorRpc } from '../src/lib/host-rpc.js';
import type {
  ConnectorRpcHandler,
  PeerAdmission,
  RpcRequest,
  RpcResult,
  WebRoute,
} from '../src/host-api.js';

interface RpcState {
  route?: WebRoute;
  disposed: boolean;
  disposeEffect?: () => void;
}

type RequestOverrides = Partial<Pick<IncomingMessage, 'method' | 'url' | 'headers' | 'aborted'>> & {
  readonly admission?: PeerAdmission;
};

interface FakeResponse {
  status: number;
  headers: OutgoingHttpHeaders | undefined;
  body: string;
  writeHead(status: number, headers?: OutgoingHttpHeaders): void;
  end(body?: string): void;
}

function setup(handler: ConnectorRpcHandler = async (): Promise<RpcResult> => ({ ok: true, value: null })): RpcState {
  const state: RpcState = { disposed: false };
  const ctx: ConnectorHostContext = {
    webServer: {
      register(route) {
        state.route = route;
        return () => { state.disposed = true; };
      },
    },
    connection: {
      admit(req) {
        return (req as RpcRequest).admission ?? { peer: { principal: { kind: 'owner' } } };
      },
    },
    effect(register) {
      const dispose = register();
      if (dispose) state.disposeEffect = dispose;
    },
  };
  registerConnectorRpc(ctx, handler);
  return state;
}

function request(body: string, overrides: RequestOverrides = {}): RpcRequest {
  const req = Object.assign(Readable.from([body]), {
    method: 'POST',
    url: '/dsh-connect/status.get',
    headers: { 'content-type': 'application/json' } satisfies IncomingHttpHeaders,
    aborted: false,
    ...overrides,
  });
  return req as unknown as RpcRequest;
}

function response(): FakeResponse {
  return {
    status: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body ?? '';
    },
  };
}

function serverResponse(res: FakeResponse): ServerResponse {
  return res as unknown as ServerResponse;
}

test('registered RPC preserves the Connection response envelope', async () => {
  const state = setup(async (endpoint, _payload, signal, peer) => {
    assert.equal(endpoint, 'status.get');
    assert.equal(peer.principal.kind, 'owner');
    assert.equal(signal.aborted, false);
    return { ok: true, value: { connected: false } };
  });
  const req = request(JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'status.get' }));
  const res = response();
  assert.ok(state.route);
  await state.route.handler(req, serverResponse(res));
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body) as unknown, {
    type: 'server-response', rpcId: 'rpc-1', result: { ok: true, value: { connected: false } },
  });
  assert.ok(state.disposeEffect);
  state.disposeEffect();
  assert.equal(state.disposed, true);
});

test('Connection admission rejection is preserved', async () => {
  const state = setup();
  const req = request('', { admission: { rejection: 401 } });
  const res = response();
  assert.ok(state.route);
  await state.route.handler(req, serverResponse(res));
  assert.equal(res.status, 401);
  assert.equal(res.body, 'unauthorized');
});

test('non-POST requests do not fall through to a static frontend', async () => {
  const state = setup();
  const res = response();
  assert.ok(state.route);
  await state.route.handler(request('', { method: 'GET' }), serverResponse(res));
  assert.equal(res.status, 404);
  assert.equal(res.body, 'not found');
});
