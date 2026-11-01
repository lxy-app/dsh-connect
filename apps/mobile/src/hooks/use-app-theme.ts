import { useColorScheme } from 'react-native';

import { Colors, type AppTheme } from '@/constants/theme';

export function useAppTheme(): AppTheme {
  const colorScheme = useColorScheme();
  return Colors[colorScheme === 'dark' ? 'dark' : 'light'];
}
