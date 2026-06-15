import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { FontSize, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'display' | 'title' | 'h2' | 'h3' | 'body' | 'label' | 'caption' | 'tiny';

export interface TxtProps extends TextProps {
  variant?: Variant;
  color?: ThemeColor;
  weight?: TextStyle['fontWeight'];
  center?: boolean;
  muted?: boolean;
}

const VARIANTS: Record<Variant, { fontSize: number; lineHeight: number; weight: TextStyle['fontWeight'] }> = {
  display: { fontSize: FontSize.display, lineHeight: 38, weight: '800' },
  title: { fontSize: FontSize.xxl, lineHeight: 32, weight: '700' },
  h2: { fontSize: FontSize.xl, lineHeight: 27, weight: '700' },
  h3: { fontSize: FontSize.lg, lineHeight: 24, weight: '600' },
  body: { fontSize: FontSize.md, lineHeight: 22, weight: '500' },
  label: { fontSize: FontSize.sm, lineHeight: 18, weight: '600' },
  caption: { fontSize: FontSize.sm, lineHeight: 18, weight: '500' },
  tiny: { fontSize: FontSize.xs, lineHeight: 15, weight: '600' },
};

export function Txt({ variant = 'body', color, weight, center, muted, style, ...rest }: TxtProps) {
  const theme = useTheme();
  const v = VARIANTS[variant];
  const resolved = color ? theme[color] : muted ? theme.textSecondary : theme.text;
  return (
    <RNText
      style={[
        {
          color: resolved,
          fontSize: v.fontSize,
          lineHeight: v.lineHeight,
          fontWeight: weight ?? v.weight,
          textAlign: center ? 'center' : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}
