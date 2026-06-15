/**
 * FileMint design tokens.
 *
 * Dark-first palette inspired by modern document utility apps. `Colors.dark`
 * and `Colors.light` share the exact same keys so `ThemeColor` stays a clean
 * union and `useTheme()` can swap palettes without any component changes.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  dark: {
    text: '#EAF0F6',
    textSecondary: '#9AA4B2',
    textMuted: '#626C7A',

    background: '#0B0F14',
    backgroundElevated: '#121821',
    card: '#141C26',
    backgroundElement: '#1A222D',
    backgroundSelected: '#22303F',

    border: '#202A35',
    borderStrong: '#2C3845',

    primary: '#2BD9A8',
    primaryMuted: 'rgba(43,217,168,0.14)',
    primaryText: '#04221A',

    danger: '#FF5C5C',
    dangerMuted: 'rgba(255,92,92,0.14)',
    warning: '#FFB020',
    warningMuted: 'rgba(255,176,32,0.14)',
    success: '#34D399',
    info: '#3B82F6',

    tabBar: '#0E141B',
    tabBarBorder: '#1A222D',
    tabInactive: '#69727F',

    overlay: 'rgba(2,5,8,0.72)',
    skeleton: '#1A222D',
    shadow: '#000000',
  },
  light: {
    text: '#0B1117',
    textSecondary: '#566069',
    textMuted: '#8B95A1',

    background: '#F3F5F8',
    backgroundElevated: '#FFFFFF',
    card: '#FFFFFF',
    backgroundElement: '#ECEFF3',
    backgroundSelected: '#DCE3EC',

    border: '#E3E8EE',
    borderStrong: '#CFD6DF',

    primary: '#10B488',
    primaryMuted: 'rgba(16,180,136,0.12)',
    primaryText: '#FFFFFF',

    danger: '#E5484D',
    dangerMuted: 'rgba(229,72,77,0.12)',
    warning: '#D9820B',
    warningMuted: 'rgba(217,130,11,0.12)',
    success: '#16A34A',
    info: '#2563EB',

    tabBar: '#FFFFFF',
    tabBarBorder: '#E6EAEF',
    tabInactive: '#97A1AD',

    overlay: 'rgba(15,23,32,0.45)',
    skeleton: '#E6EAEF',
    shadow: '#1B2733',
  },
} as const;

export type ThemeName = keyof typeof Colors;
export type ThemeColor = keyof typeof Colors.dark & keyof typeof Colors.light;
/** All palette values widened to string so dark/light are interchangeable. */
export type Palette = { [K in keyof (typeof Colors)['dark']]: string };

/**
 * Vivid accent colors used for tool tiles and file-type badges. Theme
 * independent so the colorful icon grid looks the same in light and dark.
 */
export const Accents = {
  red: '#FF5A5F',
  orange: '#FF8A3D',
  amber: '#FFC93C',
  yellow: '#F7C948',
  lime: '#8FD14F',
  green: '#34D399',
  emerald: '#10B981',
  teal: '#2BD9A8',
  cyan: '#22D3EE',
  sky: '#38BDF8',
  blue: '#3B82F6',
  indigo: '#6366F1',
  violet: '#8B5CF6',
  purple: '#A855F7',
  fuchsia: '#D946EF',
  pink: '#EC4899',
  rose: '#FB7185',
  slate: '#64748B',
} as const;

export type AccentName = keyof typeof Accents;

export const Radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 30,
  pill: 999,
} as const;

export const Spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  huge: 40,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  display: 32,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
})!;

export const TAB_BAR_HEIGHT = 64;
export const MaxContentWidth = 880;
export const DesktopContentWidth = 1240;
export const DESKTOP_SIDEBAR_WIDTH = 286;

/** Soft elevation shadow shared by cards / FAB. */
export function elevation(level: 1 | 2 | 3 = 1) {
  const map = {
    1: { radius: 8, opacity: 0.18, y: 2 },
    2: { radius: 16, opacity: 0.24, y: 6 },
    3: { radius: 28, opacity: 0.32, y: 12 },
  } as const;
  const e = map[level];
  return Platform.select({
    android: { elevation: level * 4 },
    default: {
      shadowColor: '#000000',
      shadowOpacity: e.opacity,
      shadowRadius: e.radius,
      shadowOffset: { width: 0, height: e.y },
    },
  })!;
}
