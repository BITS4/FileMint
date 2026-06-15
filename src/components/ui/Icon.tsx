import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/use-theme';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  set?: 'mc' | 'ion';
}

/** Thin wrapper so the rest of the app references icons by string name. */
export function Icon({ name, size = 22, color, set = 'mc' }: IconProps) {
  const theme = useTheme();
  const tint = color ?? theme.text;
  if (set === 'ion') {
    return <Ionicons name={name as never} size={size} color={tint} />;
  }
  return <MaterialCommunityIcons name={name as never} size={size} color={tint} />;
}
