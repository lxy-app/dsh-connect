import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeMobileApiError, getMobileWorkspaceModel } from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';
import { selectionInCatalog } from '@shared/lib/session-model';
import type { MobileModelSelection, MobileSessionModelCatalog } from '@shared/types/mobile';

/** Loads a workspace catalog and keeps the new Session's selection local until submit. */
export function useNewSessionModel(deviceId?: string, workspaceId?: string) {
  const { authorized } = useMobileSession();
  const target = deviceId && workspaceId ? `${deviceId}\u0000${workspaceId}` : '';
  const [catalog, setCatalog] = useState<MobileSessionModelCatalog | null>(null);
  const [catalogTarget, setCatalogTarget] = useState('');
  const [selection, setSelection] = useState<MobileModelSelection | null>(null);
  const [selectionTarget, setSelectionTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catalogRef = useRef<MobileSessionModelCatalog | null>(null);
  const targetRef = useRef('');
  const generationRef = useRef(0);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!deviceId || !workspaceId) {
      generationRef.current += 1;
      targetRef.current = '';
      catalogRef.current = null;
      setCatalog(null);
      setSelection(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (targetRef.current !== target) {
      targetRef.current = target;
      catalogRef.current = null;
      setCatalog(null);
      setSelection(null);
      setError(null);
    }
    const generation = ++generationRef.current;
    if (!silent && catalogRef.current === null) setLoading(true);
    setRefreshing(true);
    try {
      const next = await authorized((serverUrl, token) =>
        getMobileWorkspaceModel(serverUrl, token, { deviceId, workspaceId }),
      );
      if (!activeRef.current || generationRef.current !== generation) return;
      catalogRef.current = next;
      setCatalog(next);
      setCatalogTarget(target);
      setSelection((current) => current && selectionInCatalog(next, current) ? current : null);
      setError(null);
    } catch (cause) {
      if (!activeRef.current || generationRef.current !== generation) return;
      setError(describeMobileApiError(cause));
    } finally {
      if (activeRef.current && generationRef.current === generation) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [authorized, deviceId, target, workspaceId]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(timer);
      generationRef.current += 1;
    };
  }, [refresh]);

  const activeCatalog = target !== '' && catalogTarget === target ? catalog : null;
  const activeSelection = target !== '' && selectionTarget === target ? selection : null;
  const displayedCatalog = useMemo(() => activeCatalog === null ? null : {
    ...activeCatalog,
    effective: activeSelection ?? activeCatalog.effective,
  }, [activeCatalog, activeSelection]);
  const selectModel = useCallback((next: MobileModelSelection) => {
    setSelection(next);
    setSelectionTarget(target);
    setError(null);
  }, [target]);

  return {
    catalog: displayedCatalog,
    selection: activeSelection,
    loading,
    refreshing,
    error,
    refresh,
    selectModel,
  };
}
