import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';

export interface TileGridProps<T> {
  items: T[];
  columns?: number;
  gap?: number;
  renderItem: (item: T, width: number, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
}

/**
 * Measures its own width and lays children out in a fixed number of columns
 * with a consistent gap. Works the same on web and native (no Dimensions
 * guessing, so it adapts to split-view / resized windows).
 */
export function TileGrid<T>({ items, columns = 4, gap = 12, renderItem, keyExtractor }: TileGridProps<T>) {
  const [width, setWidth] = useState(0);
  const itemWidth = width > 0 ? (width - gap * (columns - 1)) / columns : 0;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.grid, { gap }]}>
      {itemWidth > 0
        ? items.map((item, index) => (
            <View key={keyExtractor(item, index)} style={{ width: itemWidth }}>
              {renderItem(item, itemWidth, index)}
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
