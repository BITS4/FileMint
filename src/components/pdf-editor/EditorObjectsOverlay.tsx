import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { EditablePageObject } from '@/components/pdf-editor/EditablePageObject';
import { arrowHeadPath, pathFromDoodleObject, pathFromPoints } from '@/components/pdf-editor/ObjectPreview';
import { styles } from '@/components/pdf-editor/styles';
import { Icon, Txt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { WEB_GESTURE_STYLE } from '@/lib/pdf-editor/constants';
import { clampUnit, makeObjectId } from '@/lib/pdf-editor/model';
import { parsePositiveNumber } from '@/lib/pdf-editor/geometry';
import type { EditorObject, EditorOptions, EditorPoint, EditorToolId } from '@/lib/pdf-editor/types';

export function EditorObjectsOverlay({
  tool,
  pageIndex,
  objects,
  selectedObjectId,
  options,
  accent,
  onSelect,
  onClearSelection,
  onPatch,
  onAdd,
  onEraseDoodlesAt,
  onInteractionStateChange,
}: {
  tool: EditorToolId;
  pageIndex: number;
  objects: EditorObject[];
  selectedObjectId: string | null;
  options: EditorOptions;
  accent: string;
  onSelect: (object: EditorObject) => void;
  onClearSelection: () => void;
  onPatch: (id: string, patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject)) => void;
  onAdd: (object: EditorObject) => void;
  onEraseDoodlesAt: (pageIndex: number, point: EditorPoint, radius?: number) => void;
  onInteractionStateChange: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [drawingPoints, setDrawingPoints] = useState<EditorPoint[]>([]);
  const drawingRef = useRef<EditorPoint[]>([]);
  const overlayRef = useRef<unknown>(null);
  const drawingEnabled = tool === 'doodle';
  const eraserEnabled = drawingEnabled && options.doodleMode === 'eraser';
  const strokeColor = options.color || accent;
  const strokeWidth = parsePositiveNumber(options.thickness, options.doodleMode === 'marker' ? 9 : 4, 1, 24);
  const strokeOpacity = parsePositiveNumber(
    options.opacity,
    options.doodleMode === 'marker' ? 0.55 : 0.86,
    0.05,
    1,
  );
  const eraserRadius = 0.035;

  const localPointFromClient = (clientX: number, clientY: number) => {
    const node = overlayRef.current as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      x: clampUnit((clientX - rect.left) / layout.width),
      y: clampUnit((clientY - rect.top) / layout.height),
    };
  };

  const beginDrawing = useCallback(
    (point: EditorPoint) => {
      if (!drawingEnabled) return;
      if (eraserEnabled) {
        drawingRef.current = [point];
        setDrawingPoints([point]);
        onClearSelection();
        onEraseDoodlesAt(pageIndex, point, eraserRadius);
        onInteractionStateChange(true);
        return;
      }
      drawingRef.current = [point];
      setDrawingPoints([point]);
      onClearSelection();
      onInteractionStateChange(true);
    },
    [drawingEnabled, eraserEnabled, onClearSelection, onEraseDoodlesAt, onInteractionStateChange, pageIndex],
  );

  const updateDrawing = useCallback(
    (point: EditorPoint) => {
      if (!drawingEnabled || !drawingRef.current.length) return;
      if (eraserEnabled) {
        drawingRef.current = [point];
        setDrawingPoints([point]);
        onEraseDoodlesAt(pageIndex, point, eraserRadius);
        return;
      }
      drawingRef.current =
        options.doodleMode === 'vector' || options.doodleMode === 'arrow'
          ? [drawingRef.current[0], point]
          : [...drawingRef.current, point];
      setDrawingPoints(drawingRef.current);
    },
    [drawingEnabled, eraserEnabled, onEraseDoodlesAt, options.doodleMode, pageIndex],
  );

  const endDrawing = useCallback(() => {
    if (!eraserEnabled && drawingRef.current.length > 1) {
      const object: EditorObject = {
        id: makeObjectId(),
        pageIndex,
        type: 'doodle',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        color: strokeColor,
        opacity: strokeOpacity,
        thickness: strokeWidth,
        rotation: 0,
        doodleMode: options.doodleMode,
        points: drawingRef.current,
      };
      onAdd(object);
    }
    drawingRef.current = [];
    setDrawingPoints([]);
    onInteractionStateChange(false);
  }, [
    eraserEnabled,
    onAdd,
    onInteractionStateChange,
    options.doodleMode,
    pageIndex,
    strokeColor,
    strokeOpacity,
    strokeWidth,
  ]);

  const pointerHandlers =
    Platform.OS === 'web' && drawingEnabled
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
            if (point) beginDrawing(point);
          },
          onPointerMove: (evt: unknown) => {
            if (!drawingRef.current.length) return;
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
            if (point) updateDrawing(point);
          },
          onPointerUp: endDrawing,
          onPointerCancel: endDrawing,
          onLostPointerCapture: endDrawing,
        } as Record<string, unknown>)
      : {};

  const drawPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawingEnabled,
        onMoveShouldSetPanResponder: () => drawingEnabled,
        onStartShouldSetPanResponderCapture: () => drawingEnabled,
        onMoveShouldSetPanResponderCapture: () => drawingEnabled,
        onShouldBlockNativeResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          if (Platform.OS === 'web' || !drawingEnabled) return;
          beginDrawing({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderMove: (evt) => {
          if (Platform.OS === 'web' || !drawingEnabled || !drawingRef.current.length) return;
          updateDrawing({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderRelease: endDrawing,
        onPanResponderTerminate: endDrawing,
      }),
    [beginDrawing, drawingEnabled, endDrawing, layout.height, layout.width, updateDrawing],
  );

  return (
    <View
      ref={overlayRef as never}
      style={[StyleSheet.absoluteFill, WEB_GESTURE_STYLE]}
      onLayout={(event: LayoutChangeEvent) =>
        setLayout({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
      {...drawPan.panHandlers}
      {...pointerHandlers}
    >
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {objects
          .filter((object) => object.type === 'doodle')
          .map((object) => (
            <G key={object.id}>
              <Path
                d={pathFromDoodleObject(object, layout)}
                stroke={object.color}
                strokeWidth={object.thickness}
                strokeOpacity={object.opacity}
                fill="transparent"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {object.doodleMode === 'arrow' ? (
                <Path
                  d={arrowHeadPath(object.points ?? [], layout)}
                  stroke={object.color}
                  strokeWidth={object.thickness}
                  strokeOpacity={object.opacity}
                  fill="transparent"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </G>
          ))}
        {drawingPoints.length && !eraserEnabled ? (
          <>
            <Path
              d={pathFromPoints(drawingPoints, layout)}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              fill="transparent"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {options.doodleMode === 'arrow' ? (
              <Path
                d={arrowHeadPath(drawingPoints, layout)}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                fill="transparent"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </>
        ) : null}
        {drawingPoints.length && eraserEnabled ? (
          <Circle
            cx={drawingPoints[0].x * layout.width}
            cy={drawingPoints[0].y * layout.height}
            r={Math.max(12, eraserRadius * Math.min(layout.width, layout.height))}
            fill="rgba(255,255,255,0.28)"
            stroke={accent}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      {objects
        .filter((object) => object.type !== 'doodle')
        .map((object) => (
          <EditablePageObject
            key={object.id}
            object={object}
            selected={object.id === selectedObjectId}
            accent={object.id === selectedObjectId ? accent : theme.primary}
            layout={layout}
            onSelect={onSelect}
            onPatch={onPatch}
            onInteractionStateChange={onInteractionStateChange}
          />
        ))}
      {drawingEnabled && !drawingPoints.length ? (
        <View
          pointerEvents="none"
          style={[
            styles.drawHint,
            { backgroundColor: withAlpha(theme.background, 0.76), borderColor: withAlpha(strokeColor, 0.58) },
          ]}
        >
          <Icon
            name={eraserEnabled ? 'eraser' : 'gesture-tap'}
            size={16}
            color={eraserEnabled ? accent : strokeColor}
          />
          <Txt variant="tiny">{eraserEnabled ? 'Erase strokes' : 'Draw on the page'}</Txt>
        </View>
      ) : null}
    </View>
  );
}
