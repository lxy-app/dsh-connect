import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ConnectorScope, PairingChallenge, WorkspaceGrant } from '../types.js';
import { isRecord } from '../types.js';

export interface ConnectorState {
  readonly serverUrl: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceToken: string;
  readonly fingerprint: string;
  readonly workspaces: readonly WorkspaceGrant[];
  readonly scopes: readonly ConnectorScope[];
  readonly pendingPairing: PairingChallenge;
  readonly hostApplyStage: string;
  readonly hostPid: number;
  readonly hostUpdatedAt: string;
  readonly hostApplyError: string;
  readonly routeMatched: boolean;
}

// Cordis reloads can briefly overlap plugin instances in the same Host
// process. Share the queue by canonical filename to avoid lost updates.
const fileQueues = new Map<string, Promise<void>>();

/** P0 state persistence with atomic, owner-only replacement. */
export class FileStateStore {
  readonly #file: string;

  constructor(file: string) {
    if (!file) throw new Error('A connector state file path is required');
    this.#file = resolve(file);
  }

  get<K extends keyof ConnectorState>(key: K): Promise<ConnectorState[K] | undefined>;
  get(key: string): Promise<unknown>;
  async get(key: string): Promise<unknown> {
    await this.#queue();
    return (await this.#read())[key];
  }

  async set(key: string, value: unknown): Promise<void> {
    return this.setMany({ [key]: value });
  }

  async setMany(values: Readonly<Record<string, unknown>>): Promise<void> {
    const operation = this.#queue().then(async () => {
      const state = await this.#read();
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === null) delete state[key];
        else state[key] = value;
      }
      await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 });
      const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.#file);
    });
    fileQueues.set(this.#file, operation.catch(() => {}));
    return operation;
  }

  async all(): Promise<Record<string, unknown>> {
    await this.#queue();
    return this.#read();
  }

  #queue(): Promise<void> {
    return fileQueues.get(this.#file) ?? Promise.resolve();
  }

  async #read(): Promise<Record<string, unknown>> {
    try {
      const state: unknown = JSON.parse(await readFile(this.#file, 'utf8'));
      // Corrupt or non-object JSON must fail closed as an unpaired state.
      return isRecord(state) && !Array.isArray(state) ? state : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
}
