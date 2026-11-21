import { useRouter } from 'expo-router';

import { SessionDrawer } from '@/features/navigation/session-drawer';
import { useMobileSession } from '@/providers/mobile-session-provider';
import type { MobileSession } from '@shared/types/mobile';

/** Persistent Pad browser; replacing params keeps the detail on the same route. */
export function SessionMaster({
  currentSessionId,
  currentDeviceId,
  currentWorkspaceId,
}: {
  currentSessionId?: string;
  currentDeviceId?: string;
  currentWorkspaceId?: string;
}) {
  const router = useRouter();
  const { rememberSession } = useMobileSession();

  const openSession = (session: MobileSession) => {
    if (currentSessionId === session.sessionId) return;
    rememberSession(session);
    const params = {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      workspaceId: session.workspaceId,
      title: session.title,
      deviceName: session.deviceName,
      workspaceName: session.workspaceName,
      scopes: JSON.stringify(session.scopes),
      // SET_PARAMS merges params; clear any waiting marker left by a newly created session.
      awaitingReply: '',
    };
    if (currentSessionId) {
      // Update the current dynamic route in place, preserving its key and master state.
      router.setParams(params);
      return;
    }
    router.replace({ pathname: '/session/[sessionId]', params });
  };

  return (
    <SessionDrawer
      visible
      inline
      currentSessionId={currentSessionId}
      currentDeviceId={currentDeviceId}
      currentWorkspaceId={currentWorkspaceId}
      onClose={() => undefined}
      onCreateSession={(deviceId, workspaceId) => router.push({ pathname: '/new-session', params: { deviceId, workspaceId } })}
      onOpenSession={openSession}
    />
  );
}
