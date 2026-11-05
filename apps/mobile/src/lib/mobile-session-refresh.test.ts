import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMobileSessionRefresher,
  isSameMobileCredential,
} from './mobile-session-refresh';
import type { MobileSessionResponse, StoredMobileSession } from '@/types/mobile';

const user = {
  id: 'usr_1',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'owner',
};

function storedSession(overrides: Partial<StoredMobileSession> = {}): StoredMobileSession {
  return {
    version: 1,
    serverUrl: 'https://connect.example.com',
    mobileDeviceId: 'mob_1',
    deviceName: 'iPhone',
    user,
    accessToken: 'access-old',
    accessTokenExpiresAt: '2026-11-05T06:00:00.000Z',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2026-12-05T06:00:00.000Z',
    ...overrides,
  };
}

function refreshedResponse(overrides: Partial<MobileSessionResponse> = {}): MobileSessionResponse {
  return {
    mobileDeviceId: 'mob_1',
    user,
    accessToken: 'access-new',
    accessTokenExpiresAt: '2026-11-05T06:15:00.000Z',
    refreshToken: 'refresh-new',
    refreshTokenExpiresAt: '2026-12-05T06:15:00.000Z',
    ...overrides,
  };
}

test('cold-start recovery and screen requests share one rotation and persistence write', async () => {
  const current = storedSession();
  let rotations = 0;
  let writes = 0;
  let finishRotation: ((response: MobileSessionResponse) => void) | undefined;
  const rotationResult = new Promise<MobileSessionResponse>((resolve) => {
    finishRotation = resolve;
  });
  const refresh = createMobileSessionRefresher({
    rotate: () => {
      rotations += 1;
      return rotationResult;
    },
    isCurrent: () => true,
    persist: async () => {
      writes += 1;
      return null;
    },
  });

  const hydration = refresh(current);
  const screenRequest = refresh(current);
  assert.equal(rotations, 1);
  finishRotation?.(refreshedResponse());
  const [hydrated, authorized] = await Promise.all([hydration, screenRequest]);

  assert.equal(writes, 1);
  assert.deepEqual(hydrated, authorized);
  assert.equal(hydrated.session.accessToken, 'access-new');
  assert.equal(hydrated.session.refreshToken, 'refresh-new');
});

test('a newly paired device never joins an older device refresh', async () => {
  const previous = storedSession();
  const current = storedSession({ mobileDeviceId: 'mob_2', refreshToken: 'refresh-current' });
  const rotatedDeviceIds: string[] = [];
  const refresh = createMobileSessionRefresher({
    rotate: async (session) => {
      rotatedDeviceIds.push(session.mobileDeviceId);
      return refreshedResponse({ mobileDeviceId: session.mobileDeviceId });
    },
    isCurrent: () => true,
    persist: async () => null,
  });

  const [oldResult, newResult] = await Promise.all([refresh(previous), refresh(current)]);

  assert.deepEqual(rotatedDeviceIds, ['mob_1', 'mob_2']);
  assert.equal(oldResult.session.mobileDeviceId, 'mob_1');
  assert.equal(newResult.session.mobileDeviceId, 'mob_2');
});

test('a failed rotation releases the lock so a later attempt can retry', async () => {
  let rotations = 0;
  const refresh = createMobileSessionRefresher({
    rotate: async () => {
      rotations += 1;
      if (rotations === 1) throw new Error('network unavailable');
      return refreshedResponse();
    },
    isCurrent: () => true,
    persist: async () => null,
  });
  const current = storedSession();

  await assert.rejects(refresh(current), /network unavailable/);
  const recovered = await refresh(current);

  assert.equal(rotations, 2);
  assert.equal(recovered.session.accessToken, 'access-new');
});

test('a late rotation response does not persist over a newer pairing', async () => {
  const previous = storedSession();
  let active = previous;
  let writes = 0;
  let finishRotation: ((response: MobileSessionResponse) => void) | undefined;
  const rotationResult = new Promise<MobileSessionResponse>((resolve) => {
    finishRotation = resolve;
  });
  const refresh = createMobileSessionRefresher({
    rotate: () => rotationResult,
    isCurrent: (candidate) => candidate === active,
    persist: async () => {
      writes += 1;
      return null;
    },
  });

  const pending = refresh(previous);
  active = storedSession({ mobileDeviceId: 'mob_2', refreshToken: 'refresh-current' });
  finishRotation?.(refreshedResponse());
  await pending;

  assert.equal(writes, 0);
});

test('credential identity distinguishes rotations on the same device', () => {
  const previous = storedSession();
  const rotated = storedSession({
    accessToken: 'access-new',
    refreshToken: 'refresh-new',
  });

  assert.equal(isSameMobileCredential(previous, storedSession()), true);
  assert.equal(isSameMobileCredential(previous, rotated), false);
});
