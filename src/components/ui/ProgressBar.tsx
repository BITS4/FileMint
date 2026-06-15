import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ProgressBarProps {
  /** 0..1 determinate progress. Ignored when indeterminate. */
  progress?: number;
  indeterminate?: boolean;
  height?: number;
  color?: string;
}

export function ProgressBar({ progress = 0, indeterminate, height = 8, color }: ProgressBarProps) {
  const theme = useTheme();
  const fill = color ?? theme.primary;
  const anim = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (indeterminate) {
      anim.setValue(0);
      const loop = Animated.loop(
        Animated.timing(anim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [anim, indeterminate, progress]);

  return (
    <View
      style={[styles.track, { height, borderRadius: height, backgroundColor: theme.backgroundSelected }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {indeterminate ? (
        <Animated.View
          style={[
            styles.bar,
            {
              height,
              borderRadius: height,
              backgroundColor: fill,
              width: width * 0.35,
              transform: [
                {
                  translateX: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-width * 0.35, width],
                  }),
                },
              ],
            },
          ]}
        />
      ) : (
        <Animated.View
          style={[
            styles.bar,
            {
              height,
              borderRadius: height,
              backgroundColor: fill,
              width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0 },
});
