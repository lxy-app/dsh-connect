import type { ConnectorScope, WorkspaceGrant, WorkspaceGrants } from '../types.js';
import { protocolError } from './request-cache.js';

const VALID_SCOPES: ReadonlySet<string> = new Set(['read', 'prompt', 'approve', 'cancel']);

/** Fail-closed workspace and action authorization for every Host operation. */
export class WorkspacePolicy {
  #workspaces = new Map<string, Readonly<WorkspaceGrant>>();
  #scopes = new Set<ConnectorScope>();

  constructor(grants: Partial<WorkspaceGrants> = {}) {
    this.replace(grants);
  }

  replace({ workspaces = [], scopes = [] }: Partial<WorkspaceGrants> = {}): void {
    const nextWorkspaces = new Map<string, Readonly<WorkspaceGrant>>();
    for (const workspace of workspaces) {
      if (!workspace || typeof workspace.id !== 'string' || !workspace.id) {
        throw protocolError('invalid_workspace_grant', 'Each workspace grant requires a stable id');
      }
      nextWorkspaces.set(workspace.id, Object.freeze({ ...workspace }));
    }
    const nextScopes = new Set(scopes);
    for (const scope of nextScopes) {
      if (!VALID_SCOPES.has(scope)) {
        throw protocolError('invalid_scope', `Unsupported connector scope: ${scope}`);
      }
    }
    this.#workspaces = nextWorkspaces;
    this.#scopes = nextScopes;
  }

  authorize(workspaceId: string, scope: ConnectorScope): Readonly<WorkspaceGrant> {
    if (!this.#scopes.has(scope)) {
      throw protocolError('permission_denied', `Connector scope ${scope} is not granted`);
    }
    const workspace = this.#workspaces.get(workspaceId);
    if (!workspace) {
      throw protocolError('workspace_forbidden', 'The workspace is not in the desktop grant');
    }
    return workspace;
  }

  hasScope(scope: ConnectorScope): boolean {
    return this.#scopes.has(scope);
  }

  allowsWorkspace(workspaceId: string): boolean {
    return this.#workspaces.has(workspaceId);
  }

  list(): Readonly<WorkspaceGrant>[] {
    return [...this.#workspaces.values()];
  }
}
