import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

import { Icon } from './Icon';
import { Txt } from './Txt';

export interface SegmentedOption<T extends string> {
  label: string;
  value: T;
  icon?: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              haptics.tap();
              onChange(opt.value);
            }}
            style={[styles.segment, active && { backgroundColor: theme.primary }]}
          >
            {opt.icon ? (
              <Icon name={opt.icon} size={16} color={active ? theme.primaryText : theme.textSecondary} />
            ) : null}
            <Txt variant="label" style={{ color: active ? theme.primaryText : theme.textSecondary }}>
              {opt.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
});
