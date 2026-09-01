import { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';

import { styles } from '@/components/pdf-editor/styles';
import { Icon, Txt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import {
  clamp01,
  cloneQuad,
  moveQuad,
  pointAt,
  rectFromQuad,
  type CropPoint,
  type CropPointKey,
  type CropQuad,
  type CropTarget,
} from '@/lib/pdf-editor/geometry';
import type { CropMode } from '@/lib/pdf-editor/types';
import { WEB_GESTURE_STYLE } from '@/lib/pdf-editor/constants';

export function CropOverlay({
  quad,
  mode,
  accent,
  onChange,
  onDragStateChange,
}: {
  quad: CropQuad;
  mode: CropMode;
  accent: string;
  onChange: (quad: CropQuad) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [dragging, setDragging] = useState<{ target: CropTarget; x: number; y: number } | null>(null);
  const drag = useRef<{ target: CropTarget; start: CropQuad; startX: number; startY: number } | null>(null);
  const overlayRef = useRef<unknown>(null);

  const toPx = (p: CropPoint) => ({ x: p.x * layout.width, y: p.y * layout.height });
  const px = {
    tl: toPx(quad.tl),
    tr: toPx(quad.tr),
    br: toPx(quad.br),
    bl: toPx(quad.bl),
  };
  const mids = {
    top: pointAt(px.tl, px.tr, 0.5),
    right: pointAt(px.tr, px.br, 0.5),
    bottom: pointAt(px.bl, px.br, 0.5),
    left: pointAt(px.tl, px.bl, 0.5),
  };

  const hitTest = (x: number, y: number): CropTarget => {
    const handles: [CropTarget, CropPoint][] = [
      ['tl', px.tl],
      ['tr', px.tr],
      ['br', px.br],
      ['bl', px.bl],
      ['top', mids.top],
      ['right', mids.right],
      ['bottom', mids.bottom],
      ['left', mids.left],
    ];
    for (const [key, p] of handles) {
      if (Math.hypot(p.x - x, p.y - y) < 28) return key;
    }
    const minX = Math.min(px.tl.x, px.tr.x, px.br.x, px.bl.x);
    const maxX = Math.max(px.tl.x, px.tr.x, px.br.x, px.bl.x);
    const minY = Math.min(px.tl.y, px.tr.y, px.br.y, px.bl.y);
    const maxY = Math.max(px.tl.y, px.tr.y, px.br.y, px.bl.y);
    return x >= minX && x <= maxX && y >= minY && y <= maxY ? 'move' : 'move';
  };

  const beginDrag = (x: number, y: number) => {
    const target = hitTest(x, y);
    drag.current = { target, start: cloneQuad(quad), startX: x, startY: y };
    setDragging({ target, x, y });
    onDragStateChange?.(true);
  };

  const updateDrag = (x: number, y: number) => {
    if (!drag.current) return;
    const dx = (x - drag.current.startX) / layout.width;
    const dy = (y - drag.current.startY) / layout.height;
    const { target, start } = drag.current;
    let next = cloneQuad(start);
    if (target === 'move') {
      next = moveQuad(start, dx, dy);
    } else if (target === 'top' || target === 'bottom') {
      const keys: CropPointKey[] = target === 'top' ? ['tl', 'tr'] : ['bl', 'br'];
      keys.forEach((key) => {
        next[key].y = clamp01(start[key].y + dy);
      });
    } else if (target === 'left' || target === 'right') {
      const keys: CropPointKey[] = target === 'left' ? ['tl', 'bl'] : ['tr', 'br'];
      keys.forEach((key) => {
        next[key].x = clamp01(start[key].x + dx);
      });
    } else {
      next[target] = { x: clamp01(start[target].x + dx), y: clamp01(start[target].y + dy) };
      if (mode === 'rectangle') next = rectFromQuad(next);
    }
    onChange(next);
    setDragging({ target, x, y });
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(null);
    onDragStateChange?.(false);
  };

  const localPointFromClient = (clientX: number, clientY: number) => {
    const node = overlayRef.current as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

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
            if (point) beginDrag(point.x, point.y);
          },
          onPointerMove: (evt: unknown) => {
            if (!drag.current) return;
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
            if (point) updateDrag(point.x, point.y);
          },
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onLostPointerCapture: endDrag,
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
          beginDrag(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        },
        onPanResponderMove: (evt, gesture) => {
          if (Platform.OS === 'web' || !drag.current) return;
          updateDrag(drag.current.startX + gesture.dx, drag.current.startY + gesture.dy);
        },
        onPanResponderRelease: endDrag,
        onPanResponderTerminate: endDrag,
      }),
    [beginDrag, endDrag, updateDrag],
  );

  const path = `M0 0H${layout.width}V${layout.height}H0Z M${px.tl.x} ${px.tl.y} L${px.tr.x} ${px.tr.y} L${px.br.x} ${px.br.y} L${px.bl.x} ${px.bl.y} Z`;
  const polyPoints = `${px.tl.x},${px.tl.y} ${px.tr.x},${px.tr.y} ${px.br.x},${px.br.y} ${px.bl.x},${px.bl.y}`;
  const gridLines = [1 / 3, 2 / 3].flatMap((t) => {
    const top = pointAt(px.tl, px.tr, t);
    const bottom = pointAt(px.bl, px.br, t);
    const left = pointAt(px.tl, px.bl, t);
    const right = pointAt(px.tr, px.br, t);
    return [
      { a: top, b: bottom },
      { a: left, b: right },
    ];
  });
  const center = {
    x: (px.tl.x + px.tr.x + px.br.x + px.bl.x) / 4,
    y: (px.tl.y + px.tr.y + px.br.y + px.bl.y) / 4,
  };

  return (
    <View
      testID="crop-overlay"
      ref={overlayRef as never}
      style={[StyleSheet.absoluteFill, WEB_GESTURE_STYLE]}
      onLayout={(e: LayoutChangeEvent) =>
        setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
      {...pan.panHandlers}
      {...pointerHandlers}
    >
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Path d={path} fill="rgba(3,7,12,0.62)" fillRule="evenodd" />
        {gridLines.map((line, index) => (
          <Line
            key={index}
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            stroke={withAlpha(accent, 0.52)}
            strokeWidth={1.2}
            strokeDasharray="7 6"
          />
        ))}
        <Polygon points={polyPoints} fill="transparent" stroke={accent} strokeWidth={3.5} />
        <Circle
          cx={center.x}
          cy={center.y}
          r={20}
          fill={withAlpha(accent, 0.22)}
          stroke={accent}
          strokeWidth={1.5}
        />
      </Svg>
      {(['tl', 'tr', 'br', 'bl'] as CropPointKey[]).map((key) => (
        <View
          key={key}
          testID={`crop-handle-${key}`}
          pointerEvents="none"
          style={[
            styles.cornerHandle,
            {
              left: px[key].x - 16,
              top: px[key].y - 16,
              borderColor: accent,
              backgroundColor: theme.background,
            },
          ]}
        />
      ))}
      {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
        <View
          key={key}
          testID={`crop-handle-${key}`}
          pointerEvents="none"
          style={[
            styles.edgeHandle,
            { left: mids[key].x - 12, top: mids[key].y - 12, backgroundColor: accent },
          ]}
        />
      ))}
      <View
        pointerEvents="none"
        style={[
          styles.dragHint,
          {
            left: center.x - 64,
            top: center.y + 28,
            backgroundColor: withAlpha(theme.background, 0.88),
            borderColor: withAlpha(accent, 0.7),
          },
        ]}
      >
        <Icon name="cursor-move" size={14} color={accent} />
        <Txt variant="tiny">Drag crop</Txt>
      </View>
      {dragging ? (
        <View
          pointerEvents="none"
          style={[
            styles.magnifier,
            {
              left: Math.min(layout.width - 116, dragging.x + 18),
              top: Math.max(8, dragging.y - 74),
              borderColor: accent,
              backgroundColor: theme.backgroundElevated,
            },
          ]}
        >
          <Icon name="magnify" size={16} color={accent} />
          <Txt variant="tiny">{dragging.target}</Txt>
        </View>
      ) : null}
    </View>
  );
}
