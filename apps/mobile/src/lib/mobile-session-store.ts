import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { StoredMobileSession } from '@/types/mobile';

const SESSION_KEY = 'dsh-connect.mobile-session';
const MAX_SERIALIZED_LENGTH = 2048;

const secureOptions: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios'
    ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    : undefined;

export async function loadMobileSession(): Promise<StoredMobileSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, secureOptions);
  if (!raw) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    await deleteStoredMobileSession();
    return null;
  }
  if (!isStoredMobileSession(value)) {
    await deleteStoredMobileSession();
    return null;
  }
  return value;
}

export async function saveMobileSession(session: StoredMobileSession): Promise<void> {
  const serialized = JSON.stringify(session);
  if (serialized.length > MAX_SERIALIZED_LENGTH) {
    throw new Error('移动凭据超过系统安全存储的可靠大小限制。');
  }
  await SecureStore.setItemAsync(SESSION_KEY, serialized, secureOptions);
}

export async function deleteStoredMobileSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, secureOptions);
}

export function isStoredMobileSession(value: unknown): value is StoredMobileSession {
  if (!isRecord(value) || value.version !== 1) {
    return false;
  }
  return (
    validString(value.serverUrl, 512) &&
    validString(value.mobileDeviceId, 128) &&
    validString(value.deviceName, 128) &&
    isUser(value.user) &&
    validString(value.accessToken, 512) &&
    validDate(value.accessTokenExpiresAt) &&
    validString(value.refreshToken, 512) &&
    validDate(value.refreshTokenExpiresAt)
  );
}

function isUser(value: unknown): boolean {
  return (
    isRecord(value) &&
    validString(value.id, 128) &&
    validString(value.email, 254) &&
    validString(value.displayName, 128) &&
    validString(value.role, 32)
  );
}

function validString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
