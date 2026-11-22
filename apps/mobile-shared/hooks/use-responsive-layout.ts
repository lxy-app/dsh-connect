import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { resolveResponsiveLayout, type ResponsiveLayout } from '../lib/responsive-layout';

/** Recomputes on rotation, window resize and split-screen changes. */
export function useResponsiveLayout(hasMaster = true): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => resolveResponsiveLayout({ width, height, hasMaster }), [height, width, hasMaster]);
}
