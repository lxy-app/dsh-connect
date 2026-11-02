import { Colors, type AppTheme } from '@/constants/theme';
import { useThemeSettings } from '@/providers/theme-provider';

export function useAppTheme(): AppTheme {
  const { colorScheme } = useThemeSettings();
  return Colors[colorScheme];
}
