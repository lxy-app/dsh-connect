import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { resolveResponsiveLayout, type ResponsiveLayout } from '../lib/responsive-layout';

/** Recomputes on rotation, window resize and split-screen changes. */
export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => resolveResponsiveLayout({ width, height }), [height, width]);
}
