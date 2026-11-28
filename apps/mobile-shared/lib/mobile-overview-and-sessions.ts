import type { MobileAccessOverview, MobileSessionList } from '../types/mobile';

export interface MobileOverviewAndSessionsSettlement {
  readonly overview: PromiseSettledResult<MobileAccessOverview>;
  readonly sessions: PromiseSettledResult<MobileSessionList>;
}

/**
 * Publishes each successful request as soon as it resolves. A slow or failed
 * session list must not discard the already available desktop permissions.
 */
export async function settleMobileOverviewAndSessions(
  overviewRequest: Promise<MobileAccessOverview>,
  sessionsRequest: Promise<MobileSessionList>,
  publish: {
    readonly overview: (value: MobileAccessOverview) => void;
    readonly sessions: (value: MobileSessionList) => void;
  },
): Promise<MobileOverviewAndSessionsSettlement> {
  const [overview, sessions] = await Promise.allSettled([
    overviewRequest.then((value) => {
      publish.overview(value);
      return value;
    }),
    sessionsRequest.then((value) => {
      publish.sessions(value);
      return value;
    }),
  ]);
  return { overview, sessions };
}
