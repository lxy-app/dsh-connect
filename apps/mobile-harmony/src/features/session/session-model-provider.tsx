import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  createRequestId,
  describeMobileApiError,
  getMobileSessionModel,
  selectMobileSessionModel,
} from '@/lib/mobile-api';
import { isUncertainModelSelectionError, selectionKey } from '@shared/lib/session-model';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type { MobileModelSelection, MobileSessionModelCatalog } from '@shared/types/mobile';

export type SessionModelPending = {
  requestId: string;
  selection: MobileModelSelection;
  status: 'submitting' | 'uncertain';
};

type SessionModelContextValue = {
  data: MobileSessionModelCatalog | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  pending: SessionModelPending | null;
  refresh: (silent?: boolean) => Promise<void>;
  selectModel: (selection: MobileModelSelection) => Promise<boolean>;
};

const SessionModelContext = createContext<SessionModelContextValue | null>(null);

export function SessionModelProvider({
  deviceId,
  workspaceId,
  sessionId,
  children,
}: {
  deviceId: string;
  workspaceId: string;
  sessionId: string;
  children: ReactNode;
}) {
  const { authorized } = useMobileSession();
  const [data, setData] = useState<MobileSessionModelCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SessionModelPending | null>(null);
  const pendingRef = useRef<SessionModelPending | null>(null);
  const dataRef = useRef<MobileSessionModelCatalog | null>(null);
  const activeRef = useRef(true);
  const generationRef = useRef(0);
  const selectInFlightRef = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    const generation = ++generationRef.current;
    const showInitialLoading = !silent && dataRef.current === null;
    if (showInitialLoading) setLoading(true);
    setRefreshing(true);
    try {
      const next = await authorized((serverUrl, token) =>
        getMobileSessionModel(serverUrl, token, sessionId, { deviceId, workspaceId }),
      );
      if (!activeRef.current || generationRef.current !== generation) return;
      dataRef.current = next;
      setData(next);
      setError(null);
    } catch (cause) {
      if (!activeRef.current || generationRef.current !== generation) return;
      // A silent refresh failure leaves the last usable catalog on screen.
      setError(describeMobileApiError(cause));
    } finally {
      if (activeRef.current && generationRef.current === generation) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [authorized, deviceId, sessionId, workspaceId]);

  useEffect(() => {
    activeRef.current = true;
    const timer = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(timer);
      activeRef.current = false;
      generationRef.current += 1;
    };
  }, [refresh]);

  const selectModel = useCallback(async (selection: MobileModelSelection): Promise<boolean> => {
    if (selectInFlightRef.current) return false;
    const current = pendingRef.current;
    if (current && selectionKey(current.selection) !== selectionKey(selection)) {
      setError('上一次模型切换结果尚未确认，请先重试上一次选择。');
      return false;
    }
    selectInFlightRef.current = true;
    const nextPending: SessionModelPending = {
      requestId: current?.requestId ?? createRequestId('mmod'),
      selection,
      status: 'submitting',
    };
    pendingRef.current = nextPending;
    setPending(nextPending);
    setError(null);
    try {
      await authorized((serverUrl, token) =>
        selectMobileSessionModel(serverUrl, token, sessionId, {
          requestId: nextPending.requestId,
          deviceId,
          workspaceId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        }),
      );
      if (!activeRef.current) return true;
      pendingRef.current = null;
      setPending(null);
      setError(null);
      await refresh(true);
      return true;
    } catch (cause) {
      if (activeRef.current) {
        const uncertain = isUncertainModelSelectionError(cause);
        const latest = pendingRef.current;
        if (uncertain && latest && selectionKey(latest.selection) === selectionKey(selection)) {
          const retry = { ...latest, status: 'uncertain' as const };
          pendingRef.current = retry;
          setPending(retry);
        } else {
          pendingRef.current = null;
          setPending(null);
        }
        setError(describeMobileApiError(cause));
      }
      return false;
    } finally {
      selectInFlightRef.current = false;
    }
  }, [authorized, deviceId, refresh, sessionId, workspaceId]);

  return (
    <SessionModelContext.Provider value={{ data, loading, refreshing, error, pending, refresh, selectModel }}>
      {children}
    </SessionModelContext.Provider>
  );
}

export function useSessionModel(): SessionModelContextValue {
  const value = useContext(SessionModelContext);
  if (!value) throw new Error('useSessionModel must be used inside SessionModelProvider');
  return value;
}
