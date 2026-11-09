import type {
  MobileModelCatalogModel,
  MobileModelSelection,
  MobileSessionModelCatalog,
} from '../types/mobile';

export function sameModelSelection(
  left: MobileModelSelection | null | undefined,
  right: MobileModelSelection | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort;
}

export function selectionKey(selection: MobileModelSelection): string {
  return `${selection.provider}\u0000${selection.model}\u0000${selection.reasoningEffort ?? ''}`;
}

export function modelLabel(catalog: MobileSessionModelCatalog | null, selection: MobileModelSelection): string {
  const model = findCatalogModel(catalog, selection.provider, selection.model);
  return model?.name ?? `${selection.provider}/${selection.model}`;
}

export function findCatalogModel(
  catalog: MobileSessionModelCatalog | null,
  provider: string,
  modelId: string,
): MobileModelCatalogModel | null {
  const group = catalog?.groups.find((entry) => entry.id === provider);
  return group?.models.find((entry) => entry.id === modelId) ?? null;
}

export function selectionInCatalog(
  catalog: MobileSessionModelCatalog,
  selection: MobileModelSelection,
): boolean {
  const model = findCatalogModel(catalog, selection.provider, selection.model);
  if (!model) return false;
  if (selection.reasoningEffort === undefined) return true;
  return model.reasoning?.efforts.some((effort) => effort.id === selection.reasoningEffort) === true;
}

/** Build a complete selection, retaining a supported current effort or using the target default. */
export function selectionForRoute(
  catalog: MobileSessionModelCatalog,
  current: MobileModelSelection,
  route: { provider: string; model: string },
  requestedEffort?: string,
): MobileModelSelection | null {
  const target = findCatalogModel(catalog, route.provider, route.model);
  if (!target) return null;
  const base = { provider: route.provider, model: route.model };
  const efforts = target.reasoning?.efforts ?? [];
  if (efforts.length === 0) return base;

  const supports = (effort: string | undefined): effort is string =>
    effort !== undefined && efforts.some((entry) => entry.id === effort);
  if (requestedEffort !== undefined) {
    return supports(requestedEffort) ? { ...base, reasoningEffort: requestedEffort } : null;
  }
  if (supports(current.reasoningEffort)) return { ...base, reasoningEffort: current.reasoningEffort };
  if (supports(target.reasoning?.defaultEffort)) return { ...base, reasoningEffort: target.reasoning.defaultEffort };
  const first = efforts[0];
  return first ? { ...base, reasoningEffort: first.id } : base;
}

export function modelBadgeText(text: string | Record<string, string>): string {
  if (typeof text === 'string') return text;
  return text['zh-CN'] ?? text.zh ?? text.en ?? Object.values(text)[0] ?? '';
}

export function isUncertainModelSelectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; retryable?: unknown };
  if (candidate.retryable === true) return true;
  return candidate.code === 'timeout'
    || candidate.code === 'network_error'
    || candidate.code === 'command_timeout'
    || candidate.code === 'device_offline'
    || candidate.code === 'connector_offline';
}

export function isModelSelectionEvent(data: unknown): boolean {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    && (data as Record<string, unknown>).type === 'model/selection';
}
