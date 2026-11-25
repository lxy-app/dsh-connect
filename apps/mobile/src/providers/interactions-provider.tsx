import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { createRequestId, decideMobileInteraction, getMobileInteractions, MobileApiError } from '@/lib/mobile-api';
import { useMobileSession } from '@/providers/mobile-session-provider';
import {
  countActionableInteractions,
  feedbackForDecisionError,
  feedbackForMissing,
  feedbackRetentionUntil,
  remainingInteractionSeconds,
  type InteractionFeedback,
} from '@shared/lib/interaction-feedback';
import type { MobileInteraction, MobileInteractionAnswer } from '@shared/types/mobile';

const POLL_INTERVAL_MS = 2_000;
const FEEDBACK_DURATION_MS = 6_000;

export type InteractionDecision = {
  decision?: 'allow-once' | 'reject';
  answers?: MobileInteractionAnswer[];
};

type Terminal = { interaction: MobileInteraction; feedback: InteractionFeedback; until: number };
type InteractionsContextValue = {
  interactions: MobileInteraction[];
  pendingCount: number;
  feedback: Record<string, InteractionFeedback>;
  busyId: string | null;
  refresh: () => Promise<void>;
  decide: (interaction: MobileInteraction, decision: InteractionDecision) => Promise<void>;
};

const InteractionsContext = createContext<InteractionsContextValue | null>(null);

/** Server pending list is authoritative; resolved reasons are not available in that list. */
export function InteractionsProvider({ children }: { children: ReactNode }) {
  const { status, session, authorized } = useMobileSession();
  const identity = session?.mobileDeviceId ?? null;
  const [snapshot, setSnapshot] = useState<{ identity: string | null; items: MobileInteraction[] }>({ identity: null, items: [] });
  const [terminal, setTerminal] = useState<{ identity: string | null; items: Record<string, Terminal> }>({ identity: null, items: {} });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const inflight = useRef(false);
  const deciding = useRef(new Set<string>());
  const locked = useRef(new Set<string>());
  const terminalRef = useRef<Record<string, Terminal>>({});
  const snapshotRef = useRef(snapshot);

  const settle = useCallback((interaction: MobileInteraction, feedback: InteractionFeedback) => {
    const next = { ...terminalRef.current, [interaction.interactionId]: {
      interaction, feedback, until: feedbackRetentionUntil(feedback, interaction.expiresAt, Date.now(), FEEDBACK_DURATION_MS),
    } };
    terminalRef.current = next;
    locked.current.add(interaction.interactionId);
    if (snapshotRef.current.identity === identity) {
      const updated = { identity, items: snapshotRef.current.items.filter((item) => item.interactionId !== interaction.interactionId) };
      snapshotRef.current = updated;
      setSnapshot(updated);
    }
    setTerminal({ identity, items: next });
  }, [identity]);

  const refresh = useCallback(async (): Promise<void> => {
    if (status !== 'paired' || inflight.current) return;
    inflight.current = true;
    try {
      const next = await authorized((serverUrl, token) => getMobileInteractions(serverUrl, token));
      const now = Date.now();
      const present = new Set(next.map((item) => item.interactionId));
      const previous = snapshotRef.current;
      if (previous.identity === identity) {
        for (const item of previous.items) {
          if (!present.has(item.interactionId) && !deciding.current.has(item.interactionId) && !locked.current.has(item.interactionId)) {
            settle(item, feedbackForMissing(item, now));
          }
        }
      }
      const updated = { identity, items: next.filter((item) => !locked.current.has(item.interactionId)) };
      snapshotRef.current = updated;
      setSnapshot(updated);
    } catch {
      // Keep the known cards, but their deadline still disables them locally.
    } finally {
      inflight.current = false;
    }
  }, [authorized, identity, settle, status]);

  useEffect(() => {
    terminalRef.current = {};
    deciding.current.clear();
    locked.current.clear();
  }, [identity]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (status !== 'paired') return;
    const kickoff = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, POLL_INTERVAL_MS);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [refresh, status]);

  useEffect(() => {
    const kickoff = setTimeout(() => setClock(Date.now()), 0);
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (snapshotRef.current.identity === identity) {
        for (const item of snapshotRef.current.items) {
          if (!deciding.current.has(item.interactionId) && !locked.current.has(item.interactionId) && remainingInteractionSeconds(item.expiresAt, now) === 0) {
            settle(item, 'expired');
          }
        }
      }
      const next = Object.fromEntries(Object.entries(terminalRef.current).filter(([, value]) => value.until > now));
      if (Object.keys(next).length !== Object.keys(terminalRef.current).length) {
        terminalRef.current = next;
        setTerminal({ identity, items: next });
      }
    }, 1_000);
    return () => { clearTimeout(kickoff); clearInterval(timer); };
  }, [identity, settle]);

  const decide = useCallback(async (interaction: MobileInteraction, decision: InteractionDecision): Promise<void> => {
    const id = interaction.interactionId;
    if (deciding.current.has(id) || locked.current.has(id)) return;
    if (remainingInteractionSeconds(interaction.expiresAt, Date.now()) === 0) {
      settle(interaction, 'expired');
      return;
    }
    deciding.current.add(id);
    setBusyId(id);
    try {
      await authorized((serverUrl, token) => decideMobileInteraction(serverUrl, token, id, {
        requestId: createRequestId('mint'), ...decision,
      }));
      settle(interaction, decision.decision === 'allow-once' ? 'allowed' : decision.decision === 'reject' ? 'rejected' : 'answered');
    } catch (error) {
      settle(interaction, feedbackForDecisionError(error instanceof MobileApiError ? error.code : undefined, interaction, Date.now()));
      // An indeterminate POST outcome must not be retried with a new requestId.
      void refresh();
    } finally {
      deciding.current.delete(id);
      setBusyId((current) => current === id ? null : current);
    }
  }, [authorized, refresh, settle]);

  const active = identity !== null && snapshot.identity === identity ? snapshot.items : [];
  const pendingCount = countActionableInteractions(active, clock, busyId);
  const completed = identity !== null && terminal.identity === identity ? terminal.items : {};
  const interactions = [
    ...active.filter((item) => !completed[item.interactionId]),
    ...Object.values(completed).map((item) => item.interaction),
  ];
  const feedback = Object.fromEntries(Object.entries(completed).map(([id, item]) => [id, item.feedback]));

  return <InteractionsContext.Provider value={{ interactions, pendingCount, feedback, busyId, refresh, decide }}>{children}</InteractionsContext.Provider>;
}

export function useInteractions(): InteractionsContextValue {
  const value = useContext(InteractionsContext);
  if (!value) throw new Error('useInteractions must be used inside InteractionsProvider');
  return value;
}
