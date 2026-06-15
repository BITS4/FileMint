import { Platform, useWindowDimensions } from 'react-native';

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 980;
}

export function useIsTablet(): boolean {
  const { width } = useWindowDimensions();
  return width >= 720;
}
