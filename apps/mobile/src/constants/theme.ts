export const Colors = {
  light: {
    background: '#F5F6FA',
    surface: '#FFFFFF',
    surfaceMuted: '#ECEFF5',
    text: '#171922',
    textSecondary: '#626B7B',
    border: '#E1E5EC',
    accent: '#585CE8',
    accentSoft: '#E9EAFF',
    onAccent: '#FFFFFF',
    statusNeutral: '#7A8494',
    success: '#208A5B',
    warning: '#9A6510',
    warningSoft: '#FFF4D8',
    danger: '#B93A45',
    dangerSoft: '#FCEAEC',
  },
  dark: {
    background: '#0F1117',
    surface: '#181B24',
    surfaceMuted: '#222632',
    text: '#F4F6FB',
    textSecondary: '#A5ADBC',
    border: '#2B303D',
    accent: '#9296FF',
    accentSoft: '#292C50',
    onAccent: '#111219',
    statusNeutral: '#8D96A7',
    success: '#67D5A1',
    warning: '#F0BF68',
    warningSoft: '#352A14',
    danger: '#FF8B95',
    dangerSoft: '#3B1E24',
  },
} as const;

export const Typography = {
  caption: 12,
  secondary: 13,
  body: 14,
  control: 15,
  reading: 16,
  title: 17,
} as const;

export type AppTheme = (typeof Colors)[keyof typeof Colors];
