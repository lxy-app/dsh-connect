import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { createRequestId, decideMobileInteraction, getMobileInteractions } from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type { MobileInteraction, MobileInteractionAnswer } from '@/types/mobile';

const POLL_INTERVAL_MS = 2_000;

export type InteractionDecision = {
  decision?: 'allow-once' | 'reject';
  answers?: MobileInteractionAnswer[];
};

type InteractionsContextValue = {
  interactions: MobileInteraction[];
  busyId: string | null;
  refresh: () => Promise<void>;
  decide: (interaction: MobileInteraction, decision: InteractionDecision) => Promise<void>;
};

const InteractionsContext = createContext<InteractionsContextValue | null>(null);

/**
 * Keeps the phone's pending DSH approvals and questions in sync.
 *
 * DSH requests are short-lived, so recovery is a plain poll: any request that
 * settled on the desktop simply disappears from the next Server response. The
 * polling stops entirely while the app is in the background.
 */
export function InteractionsProvider({ children }: { children: ReactNode }) {
  const { status, session, authorized } = useMobileSession();
  const identity = session?.mobileDeviceId ?? null;
  const [snapshot, setSnapshot] = useState<{ identity: string | null; items: MobileInteraction[] }>({
    identity: null,
    items: [],
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const inflight = useRef(false);
  // A snapshot only counts for the phone identity that produced it, so a
  // re-pair can never surface another account's pending prompt.
  const interactions = identity !== null && snapshot.identity === identity ? snapshot.items : [];

  const refresh = useCallback(async (): Promise<void> => {
    if (status !== 'paired' || inflight.current) return;
    inflight.current = true;
    try {
      const next = await authorized((serverUrl, token) => getMobileInteractions(serverUrl, token));
      setSnapshot({ identity, items: next });
    } catch {
      // A transient network failure must not clear an actionable card; the
      // next poll reconciles with the Server.
    } finally {
      inflight.current = false;
    }
  }, [authorized, identity, status]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Approvals are short-lived; reconcile the moment the app is usable again.
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (status !== 'paired') return;
    // Deferring the first poll keeps the effect free of synchronous state
    // updates while still showing a pending prompt on the next tick.
    const kickoff = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [refresh, status]);

  const decide = useCallback(
    async (interaction: MobileInteraction, decision: InteractionDecision): Promise<void> => {
      setBusyId(interaction.interactionId);
      try {
        await authorized((serverUrl, token) =>
          decideMobileInteraction(serverUrl, token, interaction.interactionId, {
            requestId: createRequestId('mint'),
            ...decision,
          }),
        );
        setSnapshot((current) => ({
          ...current,
          items: current.items.filter((item) => item.interactionId !== interaction.interactionId),
        }));
      } catch (error) {
        await refresh();
        throw error;
      } finally {
        setBusyId(null);
      }
    },
    [authorized, refresh],
  );

  return (
    <InteractionsContext.Provider value={{ interactions, busyId, refresh, decide }}>
      {children}
    </InteractionsContext.Provider>
  );
}

export function useInteractions(): InteractionsContextValue {
  const value = useContext(InteractionsContext);
  if (!value) throw new Error('useInteractions must be used inside InteractionsProvider');
  return value;
}
