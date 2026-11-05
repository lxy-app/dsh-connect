import type { MobileSessionResponse, StoredMobileSession } from '@/types/mobile';

export type RefreshedMobileSession = {
  session: StoredMobileSession;
  notice: string | null;
};

type RefreshDependencies = {
  rotate: (current: StoredMobileSession) => Promise<MobileSessionResponse>;
  isCurrent: (current: StoredMobileSession) => boolean;
  persist: (updated: StoredMobileSession) => Promise<string | null>;
};

export type RefreshStoredMobileSession = (
  current: StoredMobileSession,
) => Promise<RefreshedMobileSession>;

/**
 * Serializes rotation for one credential across hydration and screen requests.
 * A different device or a newly paired credential never joins an older task.
 */
export function createMobileSessionRefresher(
  dependencies: RefreshDependencies,
): RefreshStoredMobileSession {
  let inFlight: {
    current: StoredMobileSession;
    task: Promise<RefreshedMobileSession>;
  } | null = null;

  return async (current) => {
    if (inFlight && isSameMobileCredential(inFlight.current, current)) {
      return inFlight.task;
    }

    const task = (async (): Promise<RefreshedMobileSession> => {
      const response = await dependencies.rotate(current);
      const session = mergeSessionResponse(current, response);
      // A late response for an old pairing must not replace the credential that
      // the user has already paired or rotated in the meantime.
      if (!dependencies.isCurrent(current)) return { session, notice: null };
      // The Server has already rotated the credential. Persist the replacement
      // before publishing it to screens so later requests cannot reuse the old
      // refresh token while a state update is still pending.
      const notice = await dependencies.persist(session);
      return { session, notice };
    })();
    inFlight = { current, task };
    try {
      return await task;
    } finally {
      if (inFlight?.task === task) inFlight = null;
    }
  };
}

export function isSameMobileDevice(
  left: StoredMobileSession,
  right: StoredMobileSession,
): boolean {
  return left.serverUrl === right.serverUrl && left.mobileDeviceId === right.mobileDeviceId;
}

export function isSameMobileCredential(
  left: StoredMobileSession,
  right: StoredMobileSession,
): boolean {
  return isSameMobileDevice(left, right) && left.refreshToken === right.refreshToken;
}

function mergeSessionResponse(
  stored: StoredMobileSession,
  response: MobileSessionResponse,
): StoredMobileSession {
  return {
    ...stored,
    mobileDeviceId: response.mobileDeviceId,
    user: response.user,
    accessToken: response.accessToken,
    accessTokenExpiresAt: response.accessTokenExpiresAt,
    refreshToken: response.refreshToken,
    refreshTokenExpiresAt: response.refreshTokenExpiresAt,
  };
}
