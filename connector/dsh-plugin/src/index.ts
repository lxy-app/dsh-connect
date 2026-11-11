import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HostContext, RpcResult } from './host-api.js';
import type {
  ConnectorDecisionInput,
  ConnectorMobileAccessList,
  ConnectorStatus,
  PairingCompletion,
  PublicChallenge,
  WorkspaceGrants,
  WorkspaceInfo,
} from './types.js';
import { errorCode, errorMessage } from './types.js';
import { FileStateStore } from './lib/file-state-store.js';
import { registerConnectorRpc } from './lib/host-rpc.js';
import type { StartPairingInput } from './lib/pairing.js';
import { protocolError } from './lib/request-cache.js';
import { ConnectorRuntime } from './lib/runtime.js';
import { normalizeServerUrl, normalizeSettings } from './lib/settings.js';

export const name = 'dsh-connect-connector';
export const inject = ['sessionController', 'llm', 'workspaceRegistry', 'connection', 'webServer', 'workspaceFiles', 'attachments', 'fileUploads'];

const VERSION = '0.1.4';

export interface StartPairingRequest extends StartPairingInput {
  readonly serverUrl: string;
}

export interface UpdateSettingsRequest {
  readonly serverUrl: string;
  readonly deviceName: string;
  readonly confirmServerChange?: boolean;
}

export interface ConnectorApi {
  updateSettings(input: UpdateSettingsRequest): Promise<ConnectorStatus>;
  startPairing(input: StartPairingRequest): Promise<PublicChallenge>;
  authorize(grants: WorkspaceGrants): Promise<PairingCompletion>;
  cancelPairing(): void;
  connect(): Promise<void>;
  disconnect(): void;
  listWorkspaces(): WorkspaceInfo[];
  listMobileAccess(): Promise<ConnectorMobileAccessList>;
  decideMobileAccess(input: ConnectorDecisionInput): Promise<unknown>;
  updateGrants(grants: WorkspaceGrants): Promise<unknown>;
  status(): Promise<ConnectorStatus>;
}

/** Host entry. Pairing/authorization are explicit calls from the desktop RPC panel. */
export function apply(ctx: HostContext): void {
  const store = new FileStateStore(
    process.env.DSH_CONNECT_STATE_FILE ?? join(homedir(), '.dsh-connect', 'connector.json'),
  );
  const logger = ctx.logger ?? console;
  const environmentServerUrl = process.env.DSH_CONNECT_URL ?? process.env.DSH_CONNECT_SERVER_URL;
  const recordHostStage = (stage: string, extra: Readonly<Record<string, unknown>> = {}): void => {
    void store.setMany({
      hostApplyStage: stage,
      hostPid: process.pid,
      hostUpdatedAt: new Date().toISOString(),
      ...extra,
    }).catch((error: unknown) => logger.warn?.('DSH Connect diagnostic write failed', error));
  };
  recordHostStage('apply-started');
  let runtime: ConnectorRuntime | null = null;
  let disposed = false;

  const stopRuntime = (): void => {
    runtime?.stop();
    runtime = null;
  };

  const makeRuntime = (serverUrl: string): ConnectorRuntime => {
    if (disposed) throw protocolError('connector_stopped', 'Connector has been disposed');
    stopRuntime();
    runtime = new ConnectorRuntime({
      ctx,
      store,
      serverUrl: normalizeServerUrl(serverUrl),
      connectorVersion: VERSION,
      logger,
    });
    return runtime;
  };

  const ready = (async (): Promise<void> => {
    try {
      const serverUrl = await store.get('serverUrl') ?? environmentServerUrl;
      if (serverUrl && !disposed) {
        const starting = makeRuntime(serverUrl);
        await starting.start();
        if (disposed) starting.stop();
      }
    } catch (error) {
      // Keep recovery APIs usable even if persisted state or auto-start fails.
      logger.warn?.('DSH Connect auto-start failed', error);
    }
  })();

  const api: ConnectorApi = {
    async updateSettings(input) {
      await ready;
      const settings = normalizeSettings(input);
      const [storedServerUrl, deviceId] = await Promise.all([
        store.get('serverUrl'),
        store.get('deviceId'),
      ]);
      const currentServerUrl = storedServerUrl ?? environmentServerUrl ?? null;
      let normalizedCurrent = currentServerUrl;
      if (currentServerUrl) {
        try { normalizedCurrent = normalizeServerUrl(currentServerUrl); } catch { /* Replaced by the next valid setting. */ }
      }
      const serverChanged = normalizedCurrent !== settings.serverUrl;
      if (serverChanged && deviceId && !input.confirmServerChange) {
        throw protocolError(
          'server_change_requires_pairing',
          'Changing the Server requires confirmation and desktop re-pairing',
        );
      }
      if (serverChanged) {
        stopRuntime();
        await store.setMany({
          deviceId: null,
          deviceToken: null,
          fingerprint: null,
          workspaces: null,
          scopes: null,
          pendingPairing: null,
        });
      }
      await store.setMany({ serverUrl: settings.serverUrl, deviceName: settings.deviceName });
      return api.status();
    },

    async startPairing({ serverUrl, pairingCode, deviceName }) {
      await ready;
      const settings = normalizeSettings({ serverUrl, deviceName });
      stopRuntime();
      // Credentials are scoped to one Server and are never presented to another.
      await store.setMany({
        deviceId: null,
        deviceName: settings.deviceName,
        deviceToken: null,
        fingerprint: null,
        workspaces: null,
        scopes: null,
        pendingPairing: null,
        serverUrl: settings.serverUrl,
      });
      return makeRuntime(settings.serverUrl).pairing.startPairing({ pairingCode, deviceName: settings.deviceName });
    },

    async authorize(grants) {
      await ready;
      if (!runtime) throw protocolError('invalid_pairing_state', 'Start desktop pairing first');
      const deviceId = runtime.pairing.publicChallenge()?.deviceId ?? 'unknown';
      logger.info?.(`DSH Connect pair.authorize started device=${deviceId} workspaceCount=${grants.workspaces.length} scopeCount=${grants.scopes.length}`);
      const result = await runtime.authorize(grants);
      logger.info?.(`DSH Connect pair.authorize completed device=${result.deviceId}`);
      return result;
    },

    cancelPairing() {
      runtime?.pairing.cancel();
    },

    async connect() {
      await ready;
      const serverUrl = await store.get('serverUrl') ?? environmentServerUrl;
      if (!serverUrl) throw protocolError('not_paired', 'Configure a Server and pair this desktop first');
      const current = runtime ?? makeRuntime(serverUrl);
      await current.start();
    },

    disconnect() {
      runtime?.stop();
    },

    listWorkspaces() {
      return ctx.workspaceRegistry.list().map((workspace) => ({
        id: workspace.id,
        path: workspace.path,
        title: workspace.title,
        sessionIds: [...workspace.sessionIds],
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      }));
    },

    async listMobileAccess() {
      await ready;
      if (!runtime) throw protocolError('not_paired', 'Pair this desktop before reviewing phone access');
      return runtime.mobileAccessList();
    },

    async decideMobileAccess(input) {
      await ready;
      if (!runtime) throw protocolError('not_paired', 'Pair this desktop before reviewing phone access');
      return runtime.mobileAccessDecide(input);
    },

    async updateGrants(grants) {
      await ready;
      if (!runtime) throw protocolError('not_paired', 'Pair this desktop before updating grants');
      return runtime.updateGrants(grants);
    },

    async status() {
      await ready;
      const storedServerUrl = await store.get('serverUrl');
      return {
        connectorVersion: VERSION,
        serverUrl: storedServerUrl ?? environmentServerUrl ?? null,
        configSource: storedServerUrl ? 'ui' : environmentServerUrl ? 'environment' : 'default',
        deviceId: await store.get('deviceId') ?? null,
        deviceName: await store.get('deviceName') ?? null,
        fingerprint: await store.get('fingerprint') ?? null,
        workspaces: await store.get('workspaces') ?? [],
        scopes: await store.get('scopes') ?? [],
        pairingState: runtime?.pairing.state ?? 'disconnected',
        connected: runtime?.transport.connected ?? false,
        challenge: runtime?.pairing.publicChallenge() ?? null,
      };
    },
  };

  try {
    recordHostStage('providing-service');
    ctx.provide('dshConnectConnector', api);
    recordHostStage('registering-rpc');
    registerConnectorRpc(ctx, async (endpoint, payload, _signal, peer): Promise<RpcResult> => {
      if (peer.principal.kind !== 'owner') {
        return failure('remote-access/denied', 'Owner peer required', { endpoint });
      }
      try {
        switch (endpoint) {
          case 'status.get': return success(await api.status());
          case 'workspace.list': return success(api.listWorkspaces());
          case 'mobile.access.list': return success(await api.listMobileAccess());
          case 'mobile.access.decide': return success(await api.decideMobileAccess(payload as ConnectorDecisionInput));
          case 'settings.update': return success(await api.updateSettings(payload as UpdateSettingsRequest));
          case 'pair.start': return success(await api.startPairing(payload as StartPairingRequest));
          case 'pair.authorize': return success(await api.authorize(payload as WorkspaceGrants));
          case 'pair.updateGrants': return success(await api.updateGrants(payload as WorkspaceGrants));
          case 'pair.cancel': return success(api.cancelPairing());
          case 'connection.connect': return success(await api.connect());
          case 'connection.disconnect': return success(api.disconnect());
          default: return failure('gateway/bad-request', `Unknown Connector endpoint: ${endpoint}`);
        }
      } catch (error) {
        logger.warn?.(`DSH Connect RPC ${endpoint} failed code=${errorCode(error, 'gateway/internal')}: ${errorMessage(error, String(error))}`);
        return failure(errorCode(error, 'gateway/internal'), errorMessage(error, String(error)));
      }
    });
    recordHostStage('rpc-registered', {
      routeMatched: typeof ctx.webServer.match === 'function'
        ? Boolean(ctx.webServer.match('/dsh-connect/status.get'))
        : null,
    });
    ctx.effect(() => () => {
      disposed = true;
      stopRuntime();
    }, 'dsh-connect: stop connector');
  } catch (error) {
    recordHostStage('apply-failed', {
      hostApplyError: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error),
    });
    throw error;
  }
}

function success(value: unknown): RpcResult {
  return { ok: true, value: value ?? null };
}

function failure(code: string, message: string, details: object = {}): RpcResult {
  return { ok: false, error: { code, message, details } };
}
