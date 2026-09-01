import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { pathFromPoints } from '@/components/pdf-editor/ObjectPreview';
import { styles } from '@/components/pdf-editor/styles';
import { Icon, Txt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { WEB_GESTURE_STYLE } from '@/lib/pdf-editor/constants';
import { clampUnit } from '@/lib/pdf-editor/model';
import type { EditorPoint } from '@/lib/pdf-editor/types';

export function SignatureDrawPad({
  paths,
  color,
  thickness,
  onChange,
}: {
  paths: EditorPoint[][];
  color: string;
  thickness: number;
  onChange: (paths: EditorPoint[][]) => void;
}) {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [draft, setDraft] = useState<EditorPoint[]>([]);
  const draftRef = useRef<EditorPoint[]>([]);
  const padRef = useRef<unknown>(null);

  const localPointFromClient = (clientX: number, clientY: number) => {
    const node = padRef.current as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      x: clampUnit((clientX - rect.left) / layout.width),
      y: clampUnit((clientY - rect.top) / layout.height),
    };
  };

  const begin = (point: EditorPoint) => {
    draftRef.current = [point];
    setDraft([point]);
  };
  const move = (point: EditorPoint) => {
    if (!draftRef.current.length) return;
    draftRef.current = [...draftRef.current, point];
    setDraft(draftRef.current);
  };
  const end = useCallback(() => {
    const next = draftRef.current;
    if (next.length > 1) onChange([...paths, next]);
    draftRef.current = [];
    setDraft([]);
  }, [onChange, paths]);

  const pointerHandlers =
    Platform.OS === 'web'
      ? ({
          onPointerDown: (evt: unknown) => {
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              currentTarget?: { setPointerCapture?: (id: number) => void };
              nativeEvent?: { clientX: number; clientY: number; pointerId?: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            if (native.pointerId !== undefined) e.currentTarget?.setPointerCapture?.(native.pointerId);
            const point = localPointFromClient(native.clientX, native.clientY);
            if (point) begin(point);
          },
          onPointerMove: (evt: unknown) => {
            if (!draftRef.current.length) return;
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              nativeEvent?: { clientX: number; clientY: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            const point = localPointFromClient(native.clientX, native.clientY);
            if (point) move(point);
          },
          onPointerUp: end,
          onPointerCancel: end,
          onLostPointerCapture: end,
        } as Record<string, unknown>)
      : {};

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onShouldBlockNativeResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          if (Platform.OS === 'web') return;
          begin({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderMove: (evt) => {
          if (Platform.OS === 'web') return;
          move({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderRelease: end,
        onPanResponderTerminate: end,
      }),
    [end, layout.height, layout.width],
  );

  const strokeWidth = Math.max(1.2, Math.min(10, thickness));
  const visiblePaths = draft.length ? [...paths, draft] : paths;
  return (
    <View
      ref={padRef as never}
      style={[
        styles.signaturePad,
        styles.signatureDrawPad,
        WEB_GESTURE_STYLE,
        { backgroundColor: theme.backgroundElement },
      ]}
      onLayout={(event: LayoutChangeEvent) =>
        setLayout({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
      {...pan.panHandlers}
      {...pointerHandlers}
    >
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {visiblePaths
          .filter((path) => path.length > 1)
          .map((path, index) => (
            <Path
              key={`${index}-${path.length}`}
              d={pathFromPoints(path, layout)}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeOpacity={0.96}
              fill="transparent"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
      </Svg>
      {!visiblePaths.length ? (
        <View pointerEvents="none" style={styles.signaturePadEmpty}>
          <Icon name="draw" size={24} color={color} />
          <Txt variant="caption" muted center>
            Draw with your mouse or finger.
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
