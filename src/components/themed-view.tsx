import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme, useThemeName } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  const themeName = useThemeName();
  const customColor = themeName === 'light' ? lightColor : darkColor;

  return (
    <View style={[{ backgroundColor: customColor ?? theme[type ?? 'background'] }, style]} {...otherProps} />
  );
}
