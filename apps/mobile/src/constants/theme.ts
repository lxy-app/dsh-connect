export const Colors = {
  light: {
    background: '#F4F5F7',
    surface: '#FFFFFF',
    surfaceMuted: '#EFF1F3',
    text: '#181B20',
    textSecondary: '#7D838D',
    border: '#E2E5E9',
    accent: '#4B5563',
    accentSoft: '#E8EDF2',
    onAccent: '#FFFFFF',
    statusNeutral: '#737B85',
    success: '#208A5B',
    warning: '#9A6510',
    warningSoft: '#FFF4D8',
    danger: '#B93A45',
    dangerSoft: '#FCEAEC',
  },
  dark: {
    background: '#17191D',
    surface: '#22262C',
    surfaceMuted: '#2C3138',
    text: '#F2F4F6',
    textSecondary: '#9AA1AB',
    border: '#363C44',
    accent: '#F4F6F8',
    accentSoft: '#353B43',
    onAccent: '#171A1F',
    statusNeutral: '#9299A2',
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
