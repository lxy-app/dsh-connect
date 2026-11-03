import type * as ReactTypes from 'react';
import type {
  ConnectorAccessAction,
  ConnectorDecisionInput,
  ConnectorMobileAccessGrant,
  ConnectorMobileAccessList,
  ConnectorScope,
  ConnectorStatus,
  PublicChallenge,
  WorkspaceGrant,
  WorkspaceInfo,
} from './types.js';

type ReactApi = typeof ReactTypes;
type Translate = (key: string) => string;
type Disposable = () => void;

interface RpcSuccess<T = unknown> {
  readonly ok: true;
  readonly value: T;
}

interface RpcFailure {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

interface ClientContext {
  readonly connection: {
    readonly rpc: {
      call(channel: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcSuccess | RpcFailure>;
    };
  };
  readonly locale: {
    register(namespace: string, locale: string, dictionary: Record<string, string>): Disposable;
    bind(namespace: string): Translate;
    subscribe(listener: () => void): Disposable;
  };
  readonly slots: {
    inject(key: string, callback: () => Disposable): void;
    register(options: Readonly<Record<string, unknown>>, component: ReactTypes.ComponentType): Disposable;
  };
  effect(register: () => void | Disposable): void;
}

interface ClientModule {
  readonly inject: readonly string[];
  apply(ctx: ClientContext): void;
}

interface ModuleDefinition {
  readonly id: string;
  factory(require: (id: 'react') => ReactApi): ClientModule;
}

declare global {
  interface Window {
    __ModuleLoader__: {
      load(definition: ModuleDefinition): void;
    };
  }
}

window.__ModuleLoader__.load({
  id: '@lxyapp/dsh-connect',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;
    const NS = 'dsh-connect';
    const PANEL = 'dsh-connect';
    // Single source for action order and labels; the pairing screen and the
    // post-pairing grant editor must offer exactly the same vocabulary.
    const SCOPE_OPTIONS: ReadonlyArray<readonly [ConnectorScope, string]> = [
      ['read', 'read'], ['prompt', 'prompt'], ['approve', 'approve'], ['cancel', 'cancelRun'],
    ];
    const scopeLabel = (t: Translate, scope: ConnectorScope): string => t(scope === 'cancel' ? 'cancelRun' : scope);

    const DICTS: Record<'zh' | 'en', Record<string, string>> = {
      zh: {
        appName: 'DSH Connect', title: '桌面 Connector', subtitle: '将此 DSH 桌面安全接入远程控制',
        server: 'Server 地址', code: '一次性桌面配对码', deviceName: '桌面名称',
        connect: '连接 Server', connecting: '正在连接…', authorize: '确认授权并上线', authorizing: '正在授权…',
        settings: 'Server 配置', settingsCopy: '配置仅保存在此桌面。输入时不会中断当前连接。',
        save: '保存配置', savePair: '保存并配对', saving: '正在保存…', saved: '配置已保存',
        loadFailed: '无法读取 Connector 状态，请检查插件 RPC 后重试。',
        changeServerConfirm: '更换 Server 将断开当前连接、清除本机设备凭据，并要求重新配对授权。是否继续？',
        cancel: '取消', back: '返回', retry: '重新连接', disconnect: '断开连接', rePair: '重新配对',
        challengeTitle: '核对设备并选择授权范围', challengeCopy: '当前尚未配对完成。请核对指纹并选择工作区；点击“确认授权并上线”后才会完成配对，此前 Server 不能读取任何会话。',
        workspace: '工作区授权', scopes: '允许的动作', read: '查看会话', prompt: '发送指令', approve: '远程审批', cancelRun: '取消 Turn',
        connected: '已连接', offline: '已离线', fingerprint: '设备指纹', deviceId: '设备 ID', version: 'Connector 版本',
        grantedWorkspaces: '已授权工作区', grantedScopes: '已授权动作', outbound: '仅主动出站 WSS · 不开放桌面公网入站端口',
        warning: '远程发送指令可间接修改文件或执行工具。请只授权必要工作区，并保留 DSH 原有审批。',
        pairHelp: '在 Server 管理端生成一次性配对码。配对码短时有效且只能使用一次。',
        noWorkspace: '请至少选择一个工作区', noScope: '请至少选择一个动作', paired: '桌面已授权并上线',
        cancelled: '已取消本次配对', disconnected: 'Connector 已断开', loading: '正在读取 Connector 状态…',
        mobileAccess: '手机访问授权', mobileAccessCopy: '手机配对只证明设备身份。下面的工作区和动作必须由此桌面显式批准，手机才能查看或推进会话。',
        mobileAccessEmpty: '没有手机请求访问此桌面。', mobileAccessOffline: '桌面离线，暂时无法同步手机访问请求。', mobileAccessUnavailable: '无法读取手机访问请求。请确认桌面 Connector 已加载最新版本并重新连接。',
        pendingAccess: '等待你的决定', activeAccess: '已授权', requestedAt: '请求时间', mobileUser: '手机用户',
        allowAccess: '允许这些范围', denyAccess: '拒绝', revokeAccess: '撤销访问', accessBusy: '正在提交…',
        grantTitle: '桌面授权范围', grantCopy: '可随时增减授权工作区与动作，保存后立即生效，无需重新配对。手机仍需单独申请下面的范围，并由你在此确认。',
        saveGrants: '保存授权', resetGrants: '撤销更改', grantsSaved: '桌面授权已更新', grantsOffline: '桌面当前离线，无法提交授权变更；恢复连接后重试。',
        grantWarning: '移除工作区或动作会立即收紧此桌面的远程能力：手机对这些范围的既有授权随之失效，需要重新申请并由你再次确认。不会删除 DSH 本地会话。',
        grantDirty: '有未保存的授权变更',
        accessDenied: '已拒绝这次手机访问请求', accessAllowed: '已授权此手机访问所选工作区', accessRevoked: '已撤销此手机的访问',
        noAccessWorkspace: '请至少选择一个工作区', noAccessScope: '请至少选择一个动作',
      },
      en: {
        appName: 'DSH Connect', title: 'Desktop Connector', subtitle: 'Securely connect this DSH desktop for remote control',
        server: 'Server URL', code: 'One-time desktop pairing code', deviceName: 'Desktop name',
        connect: 'Connect to Server', connecting: 'Connecting…', authorize: 'Authorize and go online', authorizing: 'Authorizing…',
        settings: 'Server settings', settingsCopy: 'Settings are stored only on this desktop. Editing does not interrupt the current connection.',
        save: 'Save settings', savePair: 'Save and pair', saving: 'Saving…', saved: 'Settings saved',
        loadFailed: 'Connector status could not be loaded. Check the plugin RPC and retry.',
        changeServerConfirm: 'Changing the Server will disconnect this desktop, remove its local device credential, and require pairing and authorization again. Continue?',
        cancel: 'Cancel', back: 'Back', retry: 'Reconnect', disconnect: 'Disconnect', rePair: 'Pair again',
        challengeTitle: 'Verify this device and choose grants', challengeCopy: 'Pairing is not complete yet. Verify the fingerprint and choose workspaces; it completes only after you select Authorize and go online. The Server cannot read sessions before then.',
        workspace: 'Workspace grants', scopes: 'Allowed actions', read: 'Read sessions', prompt: 'Send prompts', approve: 'Remote approvals', cancelRun: 'Cancel turns',
        connected: 'Connected', offline: 'Offline', fingerprint: 'Device fingerprint', deviceId: 'Device ID', version: 'Connector version',
        grantedWorkspaces: 'Authorized workspaces', grantedScopes: 'Authorized actions', outbound: 'Outbound WSS only · no public inbound desktop port',
        warning: 'Remote prompts can indirectly modify files or run tools. Grant only required workspaces and keep DSH approvals enabled.',
        pairHelp: 'Generate a one-time code in the Server admin console. It expires shortly and can be used only once.',
        noWorkspace: 'Select at least one workspace', noScope: 'Select at least one action', paired: 'Desktop authorized and online',
        cancelled: 'Pairing cancelled', disconnected: 'Connector disconnected', loading: 'Loading Connector status…',
        mobileAccess: 'Phone access', mobileAccessCopy: 'Pairing only proves the phone identity. This desktop must explicitly approve the workspaces and actions below.',
        mobileAccessEmpty: 'No phone is requesting access to this desktop.', mobileAccessOffline: 'Desktop is offline; phone access requests cannot be reviewed right now.', mobileAccessUnavailable: 'Phone access requests could not be loaded. Make sure the latest Connector build is loaded and reconnected.',
        pendingAccess: 'Waiting for your decision', activeAccess: 'Authorized', requestedAt: 'Requested', mobileUser: 'Phone user',
        allowAccess: 'Allow these scopes', denyAccess: 'Deny', revokeAccess: 'Revoke access', accessBusy: 'Submitting…',
        grantTitle: 'Desktop grants', grantCopy: 'Add or remove granted workspaces and actions at any time. Changes apply immediately without re-pairing. Phones still request their own access, which you confirm here.',
        saveGrants: 'Save grants', resetGrants: 'Discard changes', grantsSaved: 'Desktop grants updated', grantsOffline: 'The desktop is offline; grant changes cannot be saved until it reconnects.',
        grantWarning: 'Removing a workspace or action immediately narrows what this desktop offers. Existing phone access for those scopes stops working and must be requested and confirmed again. DSH local sessions are not deleted.',
        grantDirty: 'Unsaved grant changes',
        accessDenied: 'Phone access request denied', accessAllowed: 'Phone access granted for the selected workspaces', accessRevoked: 'Phone access revoked',
        noAccessWorkspace: 'Select at least one workspace', noAccessScope: 'Select at least one action',
      },
    };

    const CSS = `
      .dsc-root{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
      .dsc-root *{box-sizing:border-box}.dsc-root button,.dsc-root input{font:inherit}.dsc-wrap{width:min(780px,100%);margin:0 auto;padding:36px 28px 48px}
      .dsc-brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.dsc-logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
      .dsc-title{font-size:20px;font-weight:720;letter-spacing:-.3px}.dsc-sub{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px}
      .dsc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);padding:22px;box-shadow:0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
      .dsc-card+.dsc-card{margin-top:14px}.dsc-heading{font-size:16px;font-weight:680;margin:0 0 6px}.dsc-copy{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 18px}
      .dsc-field{margin-bottom:16px}.dsc-field label{display:block;font-size:11px;font-weight:650;margin-bottom:6px}.dsc-input{width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);outline:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
      .dsc-input:focus{border-color:var(--dsw-alias-brand-primary)}.dsc-button{min-height:38px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);padding:8px 15px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-weight:620}
      .dsc-button:hover{border-color:var(--dsw-alias-brand-primary)}.dsc-button:disabled{opacity:.45;cursor:not-allowed}.dsc-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
      .dsc-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}.dsc-badge{display:inline-flex;align-items:center;gap:6px;border-radius:8px;padding:4px 9px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
      .dsc-badge:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.dsc-online{color:var(--dsw-alias-state-success-primary)}.dsc-offline{color:var(--dsw-alias-state-warn-primary)}
      .dsc-row{display:flex;justify-content:space-between;gap:20px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.dsc-row:last-child{border-bottom:0}.dsc-row>span:first-child{color:var(--dsw-alias-label-secondary)}
      .dsc-value{font-family:"SFMono-Regular",Consolas,monospace;font-size:11px;text-align:right;overflow-wrap:anywhere}.dsc-section{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--dsw-alias-label-secondary);margin:20px 0 9px}
      .dsc-check{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.dsc-check:last-child{border-bottom:0}.dsc-check input{margin-top:3px;accent-color:var(--dsw-alias-brand-primary)}
      .dsc-check-title{font-weight:620}.dsc-check-copy{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dsc-scopes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.dsc-scopes .dsc-check{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px}
      .dsc-warning{padding:12px 14px;border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:11px;margin-top:16px}
      .dsc-error{padding:11px 13px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);margin-bottom:14px;white-space:pre-wrap}
      .dsc-notice{padding:11px 13px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);margin-bottom:14px}
      .dsc-foot{text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:18px}.dsc-empty{color:var(--dsw-alias-label-secondary);padding:14px 0}
      .dsc-access{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px;margin-top:10px;background:var(--dsw-alias-bg-base)}
      .dsc-access-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.dsc-access-name{font-weight:680;font-size:13px}.dsc-access-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .dsc-access .dsc-check{padding:5px 0;border-bottom:0}.dsc-access .dsc-scopes{grid-template-columns:repeat(3,1fr);margin-top:6px}.dsc-access-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
      .dsc-access-scopes{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.dsc-access-workspace{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      @media(max-width:600px){.dsc-wrap{padding:22px 14px}.dsc-card{padding:17px}.dsc-scopes{grid-template-columns:1fr}.dsc-row{flex-direction:column;gap:3px}.dsc-value{text-align:left}}
    `;

    interface IconProps {
      readonly size?: number;
    }

    function Icon({ size = 22 }: IconProps): ReactTypes.ReactElement {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }), h('path', { d: 'M8 21h8M12 17v4M7 9l2 2-2 2M11 13h5' }));
    }

    type ButtonProps = ReactTypes.ButtonHTMLAttributes<HTMLButtonElement> & { readonly primary?: boolean };

    function Button({ children, primary = false, ...props }: ButtonProps): ReactTypes.ReactElement {
      return h('button', { type: 'button', className: `dsc-button ${primary ? 'dsc-primary' : ''}`, ...props }, children);
    }

    type FieldProps = ReactTypes.InputHTMLAttributes<HTMLInputElement> & { readonly label: string };

    function Field({ label, ...props }: FieldProps): ReactTypes.ReactElement {
      return h('div', { className: 'dsc-field' }, h('label', null, label), h('input', { className: 'dsc-input', ...props }));
    }

    async function call<T = unknown>(ctx: ClientContext, endpoint: string, payload?: unknown): Promise<T> {
      const result = await ctx.connection.rpc.call('/dsh-connect', endpoint, payload, AbortSignal.timeout(20_000));
      if (!result.ok) {
        throw Object.assign(new Error(result.error.message), { code: result.error.code });
      }
      return result.value as T;
    }

    interface ConnectorProps {
      readonly ctx: ClientContext;
      readonly t: Translate;
    }

    function Connector({ ctx, t }: ConnectorProps): ReactTypes.ReactElement {
      const [status, setStatus] = useState<ConnectorStatus | null>(null);
      const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
      const [serverUrl, setServerUrl] = useState('');
      const [pairingCode, setPairingCode] = useState('');
      const [deviceName, setDeviceName] = useState('DSH Desktop');
      const [selected, setSelected] = useState<string[]>([]);
      const [scopes, setScopes] = useState<Record<ConnectorScope, boolean>>({ read: true, prompt: false, approve: false, cancel: false });
      // null means "no pending edit": the card then mirrors the persisted grant.
      const [grantDraft, setGrantDraft] = useState<{ workspaces: string[]; scopes: ConnectorScope[] } | null>(null);
      const [busy, setBusy] = useState('');
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [showPairing, setShowPairing] = useState(false);
      const [mobileAccess, setMobileAccess] = useState<ConnectorMobileAccessList | null>(null);
      const [mobileAccessUnavailable, setMobileAccessUnavailable] = useState(false);
      const [accessSelection, setAccessSelection] = useState<Record<string, { workspaces: string[]; scopes: ConnectorScope[] }>>({});
      const initialized = useRef(false);
      const refreshGeneration = useRef(0);

      const refresh = useCallback(async (): Promise<void> => {
        const generation = ++refreshGeneration.current;
        const [nextStatus, nextWorkspaces] = await Promise.all([
          call<ConnectorStatus>(ctx, 'status.get'), call<WorkspaceInfo[]>(ctx, 'workspace.list'),
        ]);
        let nextAccess: ConnectorMobileAccessList | null = null;
        let accessFailed = false;
        // An open pairing transport is not authenticated yet. Loading phone
        // access now would be rejected; older Servers also drop the pending
        // desktop challenge.
        if (nextStatus.connected && nextStatus.deviceId) {
          try {
            nextAccess = await call<ConnectorMobileAccessList>(ctx, 'mobile.access.list');
          } catch {
            // Access review is an additional capability; keep the base status usable.
            nextAccess = null;
            accessFailed = true;
          }
        }
        if (generation !== refreshGeneration.current) return;
        setStatus(nextStatus);
        setWorkspaces(nextWorkspaces);
        setMobileAccess(nextAccess);
        setMobileAccessUnavailable(accessFailed);
        setAccessSelection((current) => {
          const next = { ...current };
          for (const grant of nextAccess?.grants ?? []) {
            if (grant.status !== 'pending' || next[grant.grantId]) continue;
            next[grant.grantId] = {
              workspaces: grant.workspaces.map((workspace) => workspace.id),
              scopes: [...grant.scopes],
            };
          }
          return next;
        });
        if (!initialized.current) {
          setServerUrl(nextStatus.serverUrl ?? 'http://127.0.0.1:8787');
          setDeviceName(nextStatus.deviceName ?? 'DSH Desktop');
          initialized.current = true;
        }
      }, [ctx]);

      useEffect(() => {
        let active = true;
        const load = (): void => {
          void refresh().catch((reason: unknown) => { if (active) setError(describeError(reason)); });
        };
        load();
        const timer = setInterval(load, 2_000);
        return () => { active = false; refreshGeneration.current += 1; clearInterval(timer); };
      }, [refresh]);

      const run = async (name: string, action: () => unknown | Promise<unknown>, successMessage?: string): Promise<void> => {
        setBusy(name); setError(''); setNotice('');
        try {
          await action();
        } catch (reason) {
          console.warn(`DSH Connect ${name} failed`, reason);
          setError(describeError(reason));
          setBusy('');
          return;
        }
        // The action is committed; a later polling failure is not an action failure.
        try { await refresh(); } catch (reason) { console.warn('DSH Connect status refresh failed', reason); }
        if (successMessage) setNotice(successMessage);
        setBusy('');
      };

      const confirmServerChange = (): boolean => {
        if (!status?.deviceId || !status.serverUrl) return true;
        const current = status.serverUrl.trim().replace(/\/+$/, '');
        const next = serverUrl.trim().replace(/\/+$/, '');
        return current === next || window.confirm(t('changeServerConfirm'));
      };
      const saveSettings = (): void => {
        if (!confirmServerChange()) return;
        void run('settings', () => call(ctx, 'settings.update', {
          serverUrl, deviceName, confirmServerChange: true,
        }), t('saved'));
      };
      const startPairing = (): void => {
        if (!confirmServerChange()) return;
        void run('pair', async () => {
          setShowPairing(false);
          await call(ctx, 'pair.start', { serverUrl, pairingCode, deviceName });
          setPairingCode('');
        });
      };
      const authorize = (): void => {
        const grants: WorkspaceGrant[] = workspaces.filter((workspace) => selected.includes(workspace.id))
          .map((workspace) => ({ id: workspace.id, name: workspace.title, path: workspace.path }));
        const actions = SCOPE_OPTIONS.map(([scope]) => scope).filter((scope) => scopes[scope]);
        if (!grants.length) { setError(t('noWorkspace')); return; }
        if (!actions.length) { setError(t('noScope')); return; }
        console.info('DSH Connect authorization submitted', { workspaceCount: grants.length, scopes: actions });
        void run('authorize', () => call(ctx, 'pair.authorize', { workspaces: grants, scopes: actions }), t('paired'));
      };
      const toggleWorkspace = (id: string): void => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      const toggleScope = (scope: ConnectorScope): void => setScopes((current) => ({ ...current, [scope]: !current[scope] }));

      // The post-pairing editor edits a draft instead of the persisted status so
      // the 2s status poll never overwrites half-finished selections. A null
      // draft always mirrors whatever the Server currently has.
      const baseGrant = (): { workspaces: string[]; scopes: ConnectorScope[] } => ({
        workspaces: status ? status.workspaces.map((workspace) => workspace.id) : [],
        scopes: status ? [...status.scopes] : [],
      });
      const toggleGrantWorkspace = (id: string): void => {
        setGrantDraft((current) => {
          const base = current ?? baseGrant();
          return {
            ...base,
            workspaces: base.workspaces.includes(id)
              ? base.workspaces.filter((item) => item !== id)
              : [...base.workspaces, id],
          };
        });
      };
      const toggleGrantScope = (scope: ConnectorScope): void => {
        setGrantDraft((current) => {
          const base = current ?? baseGrant();
          return {
            ...base,
            scopes: base.scopes.includes(scope)
              ? base.scopes.filter((item) => item !== scope)
              : [...base.scopes, scope],
          };
        });
      };
      const saveGrants = (): void => {
        if (!status) return;
        const chosen = grantDraft ?? baseGrant();
        // The Server refuses an empty grant, so fail here with a precise reason.
        const grants: WorkspaceGrant[] = workspaces
          .filter((workspace) => chosen.workspaces.includes(workspace.id))
          .map((workspace) => ({ id: workspace.id, name: workspace.title, path: workspace.path }));
        if (!grants.length) { setError(t('noWorkspace')); return; }
        const actions = SCOPE_OPTIONS.map(([scope]) => scope).filter((scope) => chosen.scopes.includes(scope));
        if (!actions.length) { setError(t('noScope')); return; }
        void run('grants', async () => {
          await call(ctx, 'pair.updateGrants', { workspaces: grants, scopes: actions });
          setGrantDraft(null);
        }, t('grantsSaved'));
      };

      const toggleAccessWorkspace = (grant: ConnectorMobileAccessGrant, workspaceId: string): void => {
        setAccessSelection((current) => {
          const selection = current[grant.grantId] ?? { workspaces: grant.workspaces.map((item) => item.id), scopes: [...grant.scopes] };
          return {
            ...current,
            [grant.grantId]: {
              ...selection,
              workspaces: selection.workspaces.includes(workspaceId)
                ? selection.workspaces.filter((item) => item !== workspaceId)
                : [...selection.workspaces, workspaceId],
            },
          };
        });
      };
      const toggleAccessScope = (grant: ConnectorMobileAccessGrant, scope: ConnectorScope): void => {
        setAccessSelection((current) => {
          const selection = current[grant.grantId] ?? { workspaces: grant.workspaces.map((item) => item.id), scopes: [...grant.scopes] };
          return {
            ...current,
            [grant.grantId]: {
              ...selection,
              scopes: selection.scopes.includes(scope)
                ? selection.scopes.filter((item) => item !== scope)
                : [...selection.scopes, scope],
            },
          };
        });
      };
      const decideAccess = (grant: ConnectorMobileAccessGrant, action: ConnectorAccessAction): void => {
        const selection = accessSelection[grant.grantId] ?? { workspaces: grant.workspaces.map((item) => item.id), scopes: [...grant.scopes] };
        if (action === 'allow' && selection.workspaces.length === 0) { setError(t('noAccessWorkspace')); return; }
        if (action === 'allow' && selection.scopes.length === 0) { setError(t('noAccessScope')); return; }
        const requestedWorkspaces = new Set(grant.workspaces.map((workspace) => workspace.id));
        const requestedScopes = new Set<string>(grant.scopes);
        const input: ConnectorDecisionInput = {
          mobileDeviceId: grant.mobileDeviceId,
          action,
          ...(action === 'revoke' ? {} : {
            workspaces: selection.workspaces.filter((id) => requestedWorkspaces.has(id)),
            scopes: selection.scopes.filter((scope) => requestedScopes.has(scope)),
          }),
        };
        const message = action === 'allow' ? t('accessAllowed') : action === 'deny' ? t('accessDenied') : t('accessRevoked');
        void run(`access-${grant.grantId}-${action}`, () => call(ctx, 'mobile.access.decide', input), message);
      };
      const accessGrants = mobileAccess?.grants ?? [];
      const currentGrant = grantDraft ?? baseGrant();
      const grantDirty = Boolean(status && grantDraft
        && (!sameSet(grantDraft.workspaces, status.workspaces.map((workspace) => workspace.id))
          || !sameSet(grantDraft.scopes, status.scopes)));
      const accessSection = h('section', { className: 'dsc-card' },
        h('h2', { className: 'dsc-heading' }, t('mobileAccess')),
        h('p', { className: 'dsc-copy' }, t('mobileAccessCopy')),
        !status?.connected
          ? h('div', { className: 'dsc-empty' }, t('mobileAccessOffline'))
          : mobileAccessUnavailable
            ? h('div', { className: 'dsc-empty' }, t('mobileAccessUnavailable'))
            : accessGrants.length === 0
            ? h('div', { className: 'dsc-empty' }, t('mobileAccessEmpty'))
            : accessGrants.map((grant) => {
              const pending = grant.status === 'pending';
              const selection = accessSelection[grant.grantId] ?? { workspaces: grant.workspaces.map((item) => item.id), scopes: [...grant.scopes] };
              return h('div', { className: 'dsc-access', key: grant.grantId },
                h('div', { className: 'dsc-access-head' },
                  h('div', null,
                    h('div', { className: 'dsc-access-name' }, grant.mobileDeviceName ?? grant.mobileDeviceId),
                    h('div', { className: 'dsc-access-meta' }, `${grant.mobileUserName ?? ''}${grant.mobileUserName ? ' · ' : ''}${grant.mobilePlatform ?? ''}`)),
                  h('span', { className: `dsc-badge ${pending ? 'dsc-offline' : 'dsc-online'}` }, pending ? t('pendingAccess') : t('activeAccess'))),
                h('div', { className: 'dsc-access-workspace' }, grant.workspaces.map((workspace) =>
                  pending
                    ? h('label', { className: 'dsc-check', key: workspace.id },
                      h('input', { type: 'checkbox', checked: selection.workspaces.includes(workspace.id), onChange: () => toggleAccessWorkspace(grant, workspace.id) }),
                      h('span', { className: 'dsc-check-title' }, workspace.name))
                    : h('span', { className: 'dsc-badge', key: workspace.id }, workspace.name))),
                pending
                  ? h('div', { className: 'dsc-scopes' }, grant.scopes.map((scope) =>
                    h('label', { className: 'dsc-check', key: scope },
                      h('input', { type: 'checkbox', checked: selection.scopes.includes(scope), onChange: () => toggleAccessScope(grant, scope) }),
                      h('span', { className: 'dsc-check-title' }, scopeLabel(t, scope)))))
                  : h('div', { className: 'dsc-access-scopes' }, grant.scopes.map((scope) => h('span', { className: 'dsc-badge', key: scope }, scopeLabel(t, scope)))),
                h('div', { className: 'dsc-access-actions' },
                  pending
                    ? h(React.Fragment, null,
                      h(Button, { disabled: Boolean(busy), onClick: () => decideAccess(grant, 'deny') }, t('denyAccess')),
                      h(Button, { primary: true, disabled: Boolean(busy), onClick: () => decideAccess(grant, 'allow') }, busy === `access-${grant.grantId}-allow` ? t('accessBusy') : t('allowAccess')))
                    : h(Button, { disabled: Boolean(busy), onClick: () => decideAccess(grant, 'revoke') }, t('revokeAccess'))));
            }));

      const settingsCard = h('section', { className: 'dsc-card' },
        h('h2', { className: 'dsc-heading' }, t('settings')),
        h('p', { className: 'dsc-copy' }, t('settingsCopy')),
        h(Field, { label: t('server'), value: serverUrl, onChange: (event) => setServerUrl(event.target.value), placeholder: 'https://connect.example.com', autoComplete: 'url' }),
        h(Field, { label: t('deviceName'), value: deviceName, onChange: (event) => setDeviceName(event.target.value), maxLength: 256 }),
        h('div', { className: 'dsc-actions' },
          h(Button, { disabled: Boolean(busy) || !serverUrl.trim() || !deviceName.trim(), onClick: saveSettings }, busy === 'settings' ? t('saving') : t('save'))));

      let content: ReactTypes.ReactNode;
      if (!status) {
        content = h('section', { className: 'dsc-card' }, error
          ? h(React.Fragment, null,
            h('p', { className: 'dsc-copy' }, t('loadFailed')),
            h('div', { className: 'dsc-actions' }, h(Button, {
              onClick: () => { setError(''); void refresh().catch((reason: unknown) => setError(describeError(reason))); },
            }, t('retry'))))
          : t('loading'));
      } else if (status.deviceId && !showPairing && !status.challenge) {
        content = h(React.Fragment, null,
          h('section', { className: 'dsc-card' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 } },
              h('h2', { className: 'dsc-heading', style: { margin: 0 } }, status.deviceName ?? deviceName),
              h('span', { className: `dsc-badge ${status.connected ? 'dsc-online' : 'dsc-offline'}` }, status.connected ? t('connected') : t('offline'))),
            h('div', { className: 'dsc-row' }, h('span', null, t('server')), h('span', { className: 'dsc-value' }, status.serverUrl)),
            h('div', { className: 'dsc-row' }, h('span', null, t('fingerprint')), h('span', { className: 'dsc-value' }, status.fingerprint)),
            h('div', { className: 'dsc-row' }, h('span', null, t('deviceId')), h('span', { className: 'dsc-value' }, status.deviceId)),
            h('div', { className: 'dsc-row' }, h('span', null, t('version')), h('span', { className: 'dsc-value' }, status.connectorVersion)),
            h('div', { className: 'dsc-actions' },
              h(Button, { onClick: () => setShowPairing(true) }, t('rePair')),
              status.connected
                ? h(Button, { disabled: Boolean(busy), onClick: () => void run('disconnect', () => call(ctx, 'connection.disconnect'), t('disconnected')) }, t('disconnect'))
                : h(Button, { primary: true, disabled: Boolean(busy), onClick: () => void run('connect', () => call(ctx, 'connection.connect')) }, t('retry')))),
          settingsCard,
          h('section', { className: 'dsc-card' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
              h('h2', { className: 'dsc-heading', style: { margin: 0 } }, t('grantTitle')),
              grantDirty && h('span', { className: 'dsc-badge dsc-offline' }, t('grantDirty'))),
            h('p', { className: 'dsc-copy' }, t('grantCopy')),
            h('div', { className: 'dsc-section', style: { marginTop: 0 } }, t('grantedWorkspaces')),
            workspaces.length
              ? workspaces.map((workspace) => h('label', { className: 'dsc-check', key: workspace.id },
                h('input', {
                  type: 'checkbox',
                  checked: currentGrant.workspaces.includes(workspace.id),
                  disabled: Boolean(busy),
                  onChange: () => toggleGrantWorkspace(workspace.id),
                }),
                h('div', null, h('div', { className: 'dsc-check-title' }, workspace.title), h('div', { className: 'dsc-check-copy' }, workspace.path))))
              : h('div', { className: 'dsc-empty' }, '—'),
            h('div', { className: 'dsc-section' }, t('grantedScopes')),
            h('div', { className: 'dsc-scopes' }, SCOPE_OPTIONS.map(([scope]) =>
              h('label', { className: 'dsc-check', key: scope },
                h('input', {
                  type: 'checkbox',
                  checked: currentGrant.scopes.includes(scope),
                  disabled: Boolean(busy),
                  onChange: () => toggleGrantScope(scope),
                }),
                h('span', { className: 'dsc-check-title' }, scopeLabel(t, scope))))),
            !status.connected && h('div', { className: 'dsc-empty' }, t('grantsOffline')),
            h('div', { className: 'dsc-warning' }, t('grantWarning')),
            h('div', { className: 'dsc-actions' },
              grantDirty && h(Button, { disabled: Boolean(busy), onClick: () => setGrantDraft(null) }, t('resetGrants')),
              h(Button, {
                primary: true,
                disabled: Boolean(busy) || !status.connected || !grantDirty,
                onClick: saveGrants,
              }, busy === 'grants' ? t('saving') : t('saveGrants')))),
          accessSection);
      } else if (status.challenge) {
        const challenge: PublicChallenge = status.challenge;
        content = h('section', { className: 'dsc-card' },
          h('h2', { className: 'dsc-heading' }, t('challengeTitle')), h('p', { className: 'dsc-copy' }, t('challengeCopy')),
          h('div', { className: 'dsc-row' }, h('span', null, t('server')), h('span', { className: 'dsc-value' }, status.serverUrl)),
          h('div', { className: 'dsc-row' }, h('span', null, t('fingerprint')), h('span', { className: 'dsc-value' }, challenge.fingerprint)),
          h('div', { className: 'dsc-row' }, h('span', null, t('deviceId')), h('span', { className: 'dsc-value' }, challenge.deviceId)),
          h('div', { className: 'dsc-section' }, t('workspace')),
          workspaces.length
            ? workspaces.map((workspace) => h('label', { className: 'dsc-check', key: workspace.id },
              h('input', { type: 'checkbox', checked: selected.includes(workspace.id), onChange: () => toggleWorkspace(workspace.id) }),
              h('div', null, h('div', { className: 'dsc-check-title' }, workspace.title), h('div', { className: 'dsc-check-copy' }, workspace.path))))
            : h('div', { className: 'dsc-empty' }, '—'),
          h('div', { className: 'dsc-section' }, t('scopes')),
          h('div', { className: 'dsc-scopes' }, SCOPE_OPTIONS.map(([scope]) =>
            h('label', { className: 'dsc-check', key: scope }, h('input', { type: 'checkbox', checked: scopes[scope], onChange: () => toggleScope(scope) }), h('span', { className: 'dsc-check-title' }, scopeLabel(t, scope))))),
          error && h('div', { className: 'dsc-error', role: 'alert' }, error),
          h('div', { className: 'dsc-warning' }, t('warning')),
          h('div', { className: 'dsc-actions' },
            h(Button, { disabled: Boolean(busy), onClick: () => void run('cancel', () => call(ctx, 'pair.cancel'), t('cancelled')) }, t('cancel')),
            h(Button, { primary: true, disabled: Boolean(busy), onClick: authorize }, busy === 'authorize' ? t('authorizing') : t('authorize'))));
      } else {
        content = h(React.Fragment, null,
          settingsCard,
          h('section', { className: 'dsc-card' },
            h('h2', { className: 'dsc-heading' }, t('connect')), h('p', { className: 'dsc-copy' }, t('pairHelp')),
            h(Field, { label: t('code'), value: pairingCode, onChange: (event) => setPairingCode(event.target.value), placeholder: 'DC-XXXX-XXXX', autoComplete: 'off' }),
            h('div', { className: 'dsc-actions' },
              status.deviceId && h(Button, { onClick: () => setShowPairing(false) }, t('back')),
              h(Button, {
                primary: true,
                disabled: Boolean(busy) || !serverUrl.trim() || !pairingCode.trim() || !deviceName.trim(),
                onClick: startPairing,
              }, busy === 'pair' ? t('connecting') : t('savePair')))));
      }

      return h('div', { className: 'dsc-root' }, h('main', { className: 'dsc-wrap' },
        h('header', { className: 'dsc-brand' }, h('div', { className: 'dsc-logo' }, h(Icon)), h('div', null, h('div', { className: 'dsc-title' }, t('title')), h('div', { className: 'dsc-sub' }, t('subtitle')))),
        error && !status?.challenge && h('div', { className: 'dsc-error', role: 'alert' }, error),
        notice && h('div', { className: 'dsc-notice', role: 'status' }, notice),
        content,
        h('div', { className: 'dsc-foot' }, t('outbound'))));
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICTS.zh));
        ctx.effect(() => ctx.locale.register(NS, 'en', DICTS.en));
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        ctx.effect(() => () => style.remove());
        const t = ctx.locale.bind(NS);
        function Root(): ReactTypes.ReactElement {
          const [, revision] = useState(0);
          useEffect(() => ctx.locale.subscribe(() => revision((value) => value + 1)), []);
          return h(Connector, { ctx, t });
        }
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL, order: 6, label: () => t('appName'), locale: NS,
        }, Icon));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Root));
      },
    };
  },
});

/** Order-insensitive comparison so reordered grants are not "dirty". */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function describeError(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null) {
    const code = 'code' in reason && typeof reason.code === 'string' ? `${reason.code}: ` : '';
    const message = reason instanceof Error
      ? reason.message
      : 'message' in reason && typeof reason.message === 'string' ? reason.message : String(reason);
    return `${code}${message}`;
  }
  return String(reason);
}
