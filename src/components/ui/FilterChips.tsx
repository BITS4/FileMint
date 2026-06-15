import { ScrollView, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';

import { Chip } from './Chip';

export interface FilterChipItem<T extends string> {
  key: T;
  label: string;
  icon?: string;
}

export interface FilterChipsProps<T extends string> {
  items: FilterChipItem<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function FilterChips<T extends string>({ items, value, onChange }: FilterChipsProps<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((item) => (
        <Chip
          key={item.key}
          label={item.label}
          icon={item.icon}
          active={item.key === value}
          onPress={() => onChange(item.key)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingVertical: Spacing.xs, paddingRight: Spacing.lg },
});
