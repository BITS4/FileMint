import { useRef, useState, type ReactNode } from 'react';
import {
  Image,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';

import { Button, Card, Icon, IconButton, Txt } from '@/components/ui';
import { Accents, Spacing } from '@/constants/theme';
import { kindMeta } from '@/lib/format';
import {
  clamp01,
  cloneQuad,
  cropIsActive,
  profileTitle,
  type CropPoint,
  type CropPointKey,
  type CropQuad,
  type FilterId,
  type StudioPage,
  type StudioProfile,
} from '@/lib/convert-to-pdf/model';
import { withAlpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';
import { styles } from '@/app/convert-to-pdf.styles';

export function HeroPick({
  profile,
  onPick,
  error,
}: {
  profile: StudioProfile;
  onPick: () => void;
  error: string | null;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.hero}>
      <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.primary, 0.14) }]}>
        <Icon name="file-document-plus-outline" size={34} color={theme.primary} />
      </View>
      <Txt variant="display" center>
        {profileTitle(profile)}
      </Txt>
      <Txt variant="caption" muted center>
        Choose one or more supported files. FileMint opens a preview editor before it creates the PDF.
      </Txt>
      <Button title="Choose files" icon="folder-open-outline" size="lg" onPress={onPick} full />
      <View style={styles.formatRow}>
        {['DOCX', 'PPTX', 'XLSX', 'JPG', 'PNG', 'WEBP', 'HEIC', 'CSV', 'TXT'].map((item) => (
          <View
            key={item}
            style={[
              styles.formatPill,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <Txt variant="tiny" weight="800">
              {item}
            </Txt>
          </View>
        ))}
      </View>
      {error ? (
        <Txt variant="caption" center style={{ color: theme.danger }}>
          {error}
        </Txt>
      ) : null}
    </Card>
  );
}

export function CropOverlay({ page, onChange }: { page: StudioPage; onChange: (quad: CropQuad) => void }) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const keys: CropPointKey[] = ['tl', 'tr', 'br', 'bl'];
  const points = keys.map((key) => ({
    key,
    x: page.quad[key].x * size.width,
    y: page.quad[key].y * size.height,
  }));
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  const shadePath = `M0,0H${size.width}V${size.height}H0Z M${points.map((point) => `${point.x},${point.y}`).join(' L')} Z`;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  };

  const setPoint = (key: CropPointKey, point: CropPoint) => {
    onChange({
      ...cloneQuad(page.quad),
      [key]: {
        x: clamp01(point.x),
        y: clamp01(point.y),
      },
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={handleLayout}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={shadePath} fill="rgba(0,0,0,0.28)" fillRule="evenodd" />
        <Polygon points={polygon} fill="rgba(255,255,255,0.01)" stroke={theme.primary} strokeWidth={2.4} />
        <Line
          x1={points[0].x}
          y1={points[0].y}
          x2={points[2].x}
          y2={points[2].y}
          stroke="rgba(255,255,255,0.32)"
          strokeWidth={1}
          strokeDasharray="5 6"
        />
        <Line
          x1={points[1].x}
          y1={points[1].y}
          x2={points[3].x}
          y2={points[3].y}
          stroke="rgba(255,255,255,0.32)"
          strokeWidth={1}
          strokeDasharray="5 6"
        />
        {points.map((point) => (
          <Circle
            key={point.key}
            cx={point.x}
            cy={point.y}
            r={7}
            fill={theme.primary}
            stroke="#FFFFFF"
            strokeWidth={2}
          />
        ))}
      </Svg>
      {points.map((point) => (
        <CropHandle
          key={point.key}
          pointKey={point.key}
          point={page.quad[point.key]}
          stage={size}
          onChange={setPoint}
        />
      ))}
      <View
        style={[
          styles.cropHint,
          { backgroundColor: withAlpha(theme.background, 0.82), borderColor: theme.border },
        ]}
      >
        <Icon name="cursor-move" size={14} color={theme.primary} />
        <Txt variant="tiny" weight="800">
          Drag corners
        </Txt>
      </View>
    </View>
  );
}

function CropHandle({
  pointKey,
  point,
  stage,
  onChange,
}: {
  pointKey: CropPointKey;
  point: CropPoint;
  stage: { width: number; height: number };
  onChange: (key: CropPointKey, point: CropPoint) => void;
}) {
  const start = useRef(point);
  const latest = useRef(point);
  const latestStage = useRef(stage);
  const latestOnChange = useRef(onChange);
  latest.current = point;
  latestStage.current = stage;
  latestOnChange.current = onChange;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = latest.current;
      },
      onPanResponderMove: (_, gesture) => {
        const width = Math.max(1, latestStage.current.width);
        const height = Math.max(1, latestStage.current.height);
        latestOnChange.current(pointKey, {
          x: start.current.x + gesture.dx / width,
          y: start.current.y + gesture.dy / height,
        });
      },
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={[
        styles.cropHandle,
        {
          left: `${point.x * 100}%`,
          top: `${point.y * 100}%`,
        },
      ]}
    />
  );
}

export function PageFilmstrip({
  pages,
  selectedId,
  onSelect,
}: {
  pages: StudioPage[];
  selectedId?: string;
  onSelect: (page: StudioPage) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.filmstripWrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.filmstripContent}>
        {pages.map((page, index) => {
          const active = page.id === selectedId;
          return (
            <Pressable
              key={page.id}
              onPress={() => onSelect(page)}
              style={[
                styles.filmstripItem,
                {
                  borderColor: active ? theme.primary : theme.border,
                  backgroundColor: active ? withAlpha(theme.primary, 0.14) : theme.card,
                },
              ]}
            >
              <Image
                source={{ uri: page.previewUri }}
                resizeMode="cover"
                style={[styles.filmstripThumb as ImageStyle, !page.included && { opacity: 0.42 }]}
              />
              <View style={styles.filmstripLabel}>
                <Txt
                  variant="tiny"
                  weight="800"
                  numberOfLines={1}
                  style={{ color: active ? theme.primary : theme.text }}
                >
                  {index + 1}
                </Txt>
                {page.filter !== 'original' || cropIsActive(page.crop) ? (
                  <View style={[styles.filmstripDot, { backgroundColor: theme.primary }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function PageTile({
  page,
  index,
  active,
  canUp,
  canDown,
  onPress,
  onToggle,
  onUp,
  onDown,
}: {
  page: StudioPage;
  index: number;
  active: boolean;
  canUp: boolean;
  canDown: boolean;
  onPress: () => void;
  onToggle: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const theme = useTheme();
  const meta = kindMeta(page.fileKind);
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pageTile,
        {
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active ? withAlpha(theme.primary, 0.12) : theme.backgroundElement,
        },
      ]}
    >
      <Image
        source={{ uri: page.previewUri }}
        resizeMode="cover"
        style={[styles.pageThumb as ImageStyle, !page.included && { opacity: 0.4 }]}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.row}>
          <View style={[styles.kindDot, { backgroundColor: withAlpha(Accents[meta.accent], 0.18) }]}>
            <Icon name={meta.icon} size={14} color={Accents[meta.accent]} />
          </View>
          <Txt variant="label" numberOfLines={1}>
            Page {index + 1}
          </Txt>
        </View>
        <Txt variant="tiny" muted numberOfLines={1}>
          {page.fileName}
        </Txt>
        <Txt variant="tiny" muted>
          {page.filter !== 'original' ? 'Filtered' : 'Original'} -{' '}
          {cropIsActive(page.crop) ? 'Cropped' : 'Full'}
        </Txt>
      </View>
      <View style={styles.tileActions}>
        <IconButton name="arrow-up" size={18} disabled={!canUp} onPress={onUp} accessibilityLabel="Move up" />
        <IconButton
          name="arrow-down"
          size={18}
          disabled={!canDown}
          onPress={onDown}
          accessibilityLabel="Move down"
        />
        <IconButton
          name={page.included ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={21}
          color={page.included ? theme.primary : theme.textSecondary}
          onPress={onToggle}
          accessibilityLabel="Include page"
        />
      </View>
    </Pressable>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.xs }}>
      <Txt variant="label" muted style={{ marginLeft: 2 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

export function webFilterStyle(filter: FilterId) {
  if (Platform.OS !== 'web') return undefined;
  if (filter === 'original') return undefined;
  if (filter === 'grayscale') return { filter: 'grayscale(1)' } as never;
  if (filter === 'bw' || filter === 'whiteboard') return { filter: 'grayscale(1) contrast(1.9)' } as never;
  if (filter === 'darker') return { filter: 'brightness(0.82) contrast(1.18)' } as never;
  if (filter === 'brighter' || filter === 'light-text')
    return { filter: 'brightness(1.18) contrast(1.08)' } as never;
  if (filter === 'photo') return { filter: 'saturate(1.18) contrast(1.05)' } as never;
  return { filter: 'contrast(1.35) saturate(1.08)' } as never;
}
