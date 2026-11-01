import { protocolError } from './request-cache.js';

export interface ConnectorSettingsInput {
  readonly serverUrl: string;
  readonly deviceName: string;
}

export interface ConnectorSettings extends ConnectorSettingsInput {
  readonly serverUrl: string;
  readonly deviceName: string;
}

/** Validate and canonicalize user-owned connection settings on the Host. */
export function normalizeSettings(input: ConnectorSettingsInput): ConnectorSettings {
  return {
    serverUrl: normalizeServerUrl(input?.serverUrl),
    deviceName: normalizeDeviceName(input?.deviceName),
  };
}

export function normalizeServerUrl(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw protocolError('invalid_server_url', 'Server URL is required');
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw protocolError('invalid_server_url', 'Server URL is invalid');
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    throw protocolError('invalid_server_url', 'Server URL must use http(s) or ws(s)');
  }
  if (url.username || url.password) {
    throw protocolError('invalid_server_url', 'Server URL must not contain credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw protocolError('invalid_server_url', 'Server URL must not contain a path, query, or fragment');
  }
  return `${url.protocol}//${url.host}`;
}

export function normalizeDeviceName(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw protocolError('invalid_device_name', 'Desktop name is required');
  }
  const deviceName = value.trim();
  if (deviceName.length > 256) {
    throw protocolError('invalid_device_name', 'Desktop name must not exceed 256 characters');
  }
  return deviceName;
}
