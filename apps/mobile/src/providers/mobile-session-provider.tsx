import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import {
  getMobileIdentity,
  isUnauthorizedError,
  logoutMobileDevice,
  MobileApiError,
  normalizeServerUrl,
  pairMobileDevice,
  refreshMobileSession,
} from '@/lib/mobile-api';
import {
  createMobileSessionRefresher,
  isSameMobileCredential,
  isSameMobileDevice,
} from '@/lib/mobile-session-refresh';
import {
  deleteStoredMobileSession,
  loadMobileSession,
  saveMobileSession,
} from '@/lib/mobile-session-store';
import type { MobilePlatform, MobileSession, MobileSessionResponse, StoredMobileSession } from '@shared/types/mobile';

type MobileSessionStatus = 'loading' | 'unpaired' | 'paired';

type MobileSessionState = {
  status: MobileSessionStatus;
  session: StoredMobileSession | null;
  notice: string | null;
};

type PairInput = {
  serverUrl: string;
  code: string;
};

type AuthorizedOperation<T> = (serverUrl: string, accessToken: string) => Promise<T>;

type AuthorizedConnection = { serverUrl: string; accessToken: string };

type MobileSessionContextValue = MobileSessionState & {
  pair: (input: PairInput) => Promise<void>;
  disconnect: () => Promise<void>;
  dismissNotice: () => void;
  /** Runs an API call with a valid access token, rotating it once on 401. */
  authorized: <T>(operation: AuthorizedOperation<T>) => Promise<T>;
  /** Returns a fresh token for a WebSocket handshake. */
  connection: () => Promise<AuthorizedConnection>;
  lastSession: MobileSession | null;
  rememberSession: (session: MobileSession) => void;
};

const MobileSessionContext = createContext<MobileSessionContextValue | null>(null);

const INITIAL_STATE: MobileSessionState = {
  status: 'loading',
  session: null,
  notice: null,
};

export function MobileSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MobileSessionState>(INITIAL_STATE);
  const [lastSession, setLastSession] = useState<MobileSession | null>(null);
  const operationGeneration = useRef(0);
  const sessionRef = useRef<StoredMobileSession | null>(null);
  const refresherRef = useRef<ReturnType<typeof createMobileSessionRefresher> | null>(null);
  const refreshSession = useCallback((current: StoredMobileSession) => {
    if (!refresherRef.current) {
      refresherRef.current = createMobileSessionRefresher({
        rotate: (session) => refreshMobileSession(session.serverUrl, session.refreshToken),
        isCurrent: (session) => {
          const latest = sessionRef.current;
          return latest !== null && isSameMobileCredential(latest, session);
        },
        persist,
      });
    }
    return refresherRef.current(current);
  }, []);

  useEffect(() => {
    let active = true;
    const hydrationGeneration = operationGeneration.current;

    const setIfActive = (next: MobileSessionState) => {
      if (active && operationGeneration.current === hydrationGeneration) {
        sessionRef.current = next.session;
        setState(next);
      }
    };

    const refresh = async (stored: StoredMobileSession) => {
      try {
        const { session: updated, notice } = await refreshSession(stored);
        const latest = sessionRef.current;
        if (latest && !isSameMobileCredential(latest, stored)) return;
        setIfActive({ status: 'paired', session: updated, notice });
      } catch (error) {
        if (isUnauthorizedError(error)) {
          const current = sessionRef.current;
          if (!active || operationGeneration.current !== hydrationGeneration ||
            (current !== null && !isSameMobileCredential(current, stored))) {
            return;
          }
          try {
            await deleteStoredMobileSession();
          } catch {
            // The invalid credential is unusable; surface the storage issue below.
          }
          setIfActive({
            status: 'unpaired',
            session: null,
            notice: '配对凭据已失效，请重新生成配对码。',
          });
          return;
        }
        setIfActive({
          status: 'paired',
          session: stored,
          notice: '已加载本机配对信息，但暂时无法刷新 Server 凭据。',
        });
      }
    };

    const hydrate = async () => {
      let stored: StoredMobileSession | null;
      try {
        stored = await loadMobileSession();
      } catch {
        setIfActive({
          status: 'unpaired',
          session: null,
          notice: '无法读取系统安全存储，请重新配对。',
        });
        return;
      }

      if (!stored) {
        setIfActive({ status: 'unpaired', session: null, notice: null });
        return;
      }
      if (Date.parse(stored.refreshTokenExpiresAt) <= Date.now()) {
        const current = sessionRef.current;
        if (!active || operationGeneration.current !== hydrationGeneration ||
          (current !== null && !isSameMobileCredential(current, stored))) {
          return;
        }
        try {
          await deleteStoredMobileSession();
        } catch {
          // The expired session is unusable even if stale data remains.
        }
        setIfActive({
          status: 'unpaired',
          session: null,
          notice: '配对凭据已过期，请重新生成配对码。',
        });
        return;
      }

      setIfActive({ status: 'paired', session: stored, notice: null });

      if (Date.parse(stored.accessTokenExpiresAt) <= Date.now() + 30_000) {
        await refresh(stored);
        return;
      }

      try {
        const identity = await getMobileIdentity(stored.serverUrl, stored.accessToken);
        const updated: StoredMobileSession = {
          ...stored,
          mobileDeviceId: identity.mobileDevice.mobileDeviceId,
          deviceName: identity.mobileDevice.deviceName,
          user: identity.user,
        };
        const notice = await persist(updated);
        setIfActive({ status: 'paired', session: updated, notice });
      } catch (error) {
        if (isUnauthorizedError(error)) {
          await refresh(stored);
          return;
        }
        setIfActive({
          status: 'paired',
          session: stored,
          notice: '已加载本机配对信息，但当前无法验证 Server。',
        });
      }
    };

    void hydrate();
    return () => {
      active = false;
    };
  }, [refreshSession]);

  const pair = useCallback(
    async ({ serverUrl, code }: PairInput) => {
      const normalizedServerUrl = normalizeServerUrl(serverUrl);
      const device = pairingDevice();
      const previous = state.session;
      const response = await pairMobileDevice({
        serverUrl: normalizedServerUrl,
        code,
        deviceName: device.name,
        platform: device.platform,
        appVersion: appVersion(),
      });
      const stored = storedFromPairing(normalizedServerUrl, response, device.name);
      operationGeneration.current += 1;
      sessionRef.current = stored;
      const notice = await persist(stored);
      setState({ status: 'paired', session: stored, notice });

      if (previous) {
        // Replacing the local pairing should not leave the previous phone
        // credential active on the Server longer than necessary.
        void bestEffortRevoke(previous);
      }
    },
    [state.session],
  );

  const disconnect = useCallback(async () => {
    const current = state.session;
    await deleteStoredMobileSession();
    operationGeneration.current += 1;
    sessionRef.current = null;
    setState({ status: 'unpaired', session: null, notice: null });
    if (current) {
      void bestEffortRevoke(current);
    }
  }, [state.session]);

  const dismissNotice = useCallback(() => {
    setState((current) => ({ ...current, notice: null }));
  }, []);
  const rememberSession = useCallback((next: MobileSession) => setLastSession(next), []);

  const refreshSessionForRequest = useCallback(async (
    expected: StoredMobileSession,
  ): Promise<StoredMobileSession> => {
    const before = sessionRef.current ?? state.session;
    if (!before || !isSameMobileDevice(before, expected)) {
      throw new MobileApiError('unauthorized', '本机配对已变化，请重试。');
    }
    // Another request already rotated this credential while the old access
    // token was in flight. Reuse its result instead of replaying the old RT.
    if (!isSameMobileCredential(before, expected)) return before;

    const { session: updated, notice } = await refreshSession(expected);
    const latest = sessionRef.current ?? state.session;
    if (!latest || !isSameMobileDevice(latest, expected)) {
      throw new MobileApiError('unauthorized', '本机配对已变化，请重试。');
    }
    if (!isSameMobileCredential(latest, expected)) return latest;
    sessionRef.current = updated;
    setState({ status: 'paired', session: updated, notice });
    return updated;
  }, [refreshSession, state.session]);

  const clearInvalidSession = useCallback(async (invalidated: StoredMobileSession): Promise<void> => {
    const current = sessionRef.current ?? state.session;
    // A delayed 401 must not delete a newer rotation or a newly paired device.
    if (!current || !isSameMobileCredential(current, invalidated)) return;
    try {
      await deleteStoredMobileSession();
    } catch {
      // The invalid credential is unusable even if stale data remains.
    }
    const latest = sessionRef.current ?? state.session;
    if (!latest || !isSameMobileCredential(latest, invalidated)) return;
    sessionRef.current = null;
    setState({
      status: 'unpaired',
      session: null,
      notice: '配对凭据已失效，请重新配对。',
    });
  }, [state.session]);

  const authorized = useCallback(
    async <T,>(operation: AuthorizedOperation<T>): Promise<T> => {
      const current = sessionRef.current ?? state.session;
      if (!current) throw new MobileApiError('unauthorized', '尚未配对这台手机。');
      let credential = current;
      try {
        if (Date.parse(credential.accessTokenExpiresAt) <= Date.now() + 30_000) {
          credential = await refreshSessionForRequest(credential);
        }
        try {
          return await operation(credential.serverUrl, credential.accessToken);
        } catch (error) {
          if (!isUnauthorizedError(error)) throw error;
          credential = await refreshSessionForRequest(credential);
          return await operation(credential.serverUrl, credential.accessToken);
        }
      } catch (error) {
        if (isUnauthorizedError(error)) await clearInvalidSession(credential);
        throw error;
      }
    },
    [clearInvalidSession, refreshSessionForRequest, state.session],
  );

  const connection = useCallback(
    async (): Promise<AuthorizedConnection> => {
      const current = sessionRef.current ?? state.session;
      if (!current) throw new MobileApiError('unauthorized', '尚未配对这台手机。');
      let credential = current;
      if (Date.parse(credential.accessTokenExpiresAt) <= Date.now() + 30_000) {
        credential = await refreshSessionForRequest(credential);
      }
      return { serverUrl: credential.serverUrl, accessToken: credential.accessToken };
    },
    [refreshSessionForRequest, state.session],
  );

  return (
    <MobileSessionContext.Provider
      value={{
        ...state,
        pair,
        disconnect,
        dismissNotice,
        authorized,
        connection,
        lastSession,
        rememberSession,
      }}
    >
      {children}
    </MobileSessionContext.Provider>
  );
}

export function useMobileSession(): MobileSessionContextValue {
  const context = useContext(MobileSessionContext);
  if (!context) {
    throw new Error('useMobileSession must be used inside MobileSessionProvider');
  }
  return context;
}

async function persist(session: StoredMobileSession): Promise<string | null> {
  try {
    await saveMobileSession(session);
    return null;
  } catch {
    return '无法写入系统安全存储；关闭 App 后可能需要重新配对。';
  }
}

function storedFromPairing(
  serverUrl: string,
  response: MobileSessionResponse,
  deviceName: string,
): StoredMobileSession {
  return {
    version: 1,
    serverUrl,
    mobileDeviceId: response.mobileDeviceId,
    deviceName,
    user: response.user,
    accessToken: response.accessToken,
    accessTokenExpiresAt: response.accessTokenExpiresAt,
    refreshToken: response.refreshToken,
    refreshTokenExpiresAt: response.refreshTokenExpiresAt,
  };
}

function pairingDevice(): { name: string; platform: MobilePlatform } {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('手机配对仅支持 iOS 与 Android。');
  }
  const name = (Device.deviceName ?? Device.modelName ?? '').trim().slice(0, 128);
  return {
    platform: Platform.OS,
    name: name || (Platform.OS === 'ios' ? 'iPhone' : 'Android Phone'),
  };
}

function appVersion(): string {
  return (Constants.expoConfig?.version ?? '0.1.0').slice(0, 64);
}

/**
 * Revokes the Server-side mobile session even after the access token has
 * expired by rotating once first. Local credentials are already replaced or
 * deleted when this runs, so failures are intentionally best-effort.
 */
async function bestEffortRevoke(session: StoredMobileSession): Promise<void> {
  try {
    let accessToken = session.accessToken;
    if (Date.parse(session.accessTokenExpiresAt) <= Date.now() + 30_000) {
      const refreshed = await refreshMobileSession(session.serverUrl, session.refreshToken);
      accessToken = refreshed.accessToken;
    }
    await logoutMobileDevice(session.serverUrl, accessToken);
  } catch {
    // The local pairing is already gone; administrators can still revoke the
    // device from the Server.
  }
}
