export const EXPANDED_PORTRAIT_MIN_WIDTH = 744;
export const EXPANDED_LANDSCAPE_MIN_WIDTH = 1024;

export type LayoutMode = 'compact' | 'expanded';
export type LayoutOrientation = 'portrait' | 'landscape';

export type ResponsiveLayout = {
  mode: LayoutMode;
  isExpanded: boolean;
  orientation: LayoutOrientation;
  navigationRailWidth: number;
  sessionMasterWidth: number;
  detailWidth: number;
  readingMaxWidth: number;
  formMaxWidth: number;
  sheetMaxWidth: number;
  attachmentSheetMaxWidth: number;
  touchTargetSize: number;
};

/**
 * Resolves layout from the current app window, never from a device model.
 * Narrow Split View / Stage Manager windows therefore keep the compact UI.
 */
export function resolveResponsiveLayout({ width, height, hasMaster = true }: { width: number; height: number; hasMaster?: boolean }): ResponsiveLayout {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const orientation: LayoutOrientation = safeWidth >= safeHeight ? 'landscape' : 'portrait';
  const isExpanded = orientation === 'portrait'
    ? safeWidth >= EXPANDED_PORTRAIT_MIN_WIDTH
    : safeWidth >= EXPANDED_LANDSCAPE_MIN_WIDTH;
  const navigationRailWidth = isExpanded ? 76 : 0;
  const sessionMasterWidth = isExpanded && hasMaster ? (orientation === 'landscape' ? 324 : 300) : 0;

  return {
    mode: isExpanded ? 'expanded' : 'compact',
    isExpanded,
    orientation,
    navigationRailWidth,
    sessionMasterWidth,
    detailWidth: Math.max(0, safeWidth - navigationRailWidth - sessionMasterWidth),
    readingMaxWidth: 760,
    formMaxWidth: 680,
    sheetMaxWidth: 520,
    attachmentSheetMaxWidth: 640,
    touchTargetSize: isExpanded ? 44 : 36,
  };
}
