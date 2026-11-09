export type ThemePreference = 'system' | 'light' | 'dark';
export type AppColorScheme = Exclude<ThemePreference, 'system'>;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export function parseThemePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_THEME_PREFERENCE;
}

export function resolveColorScheme(
  preference: ThemePreference,
  systemColorScheme: 'light' | 'dark' | null | undefined,
): AppColorScheme {
  if (preference !== 'system') return preference;
  return systemColorScheme === 'dark' ? 'dark' : 'light';
}
