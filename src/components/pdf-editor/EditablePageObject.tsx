import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, Platform, View } from 'react-native';

import { ObjectPreview } from '@/components/pdf-editor/ObjectPreview';
import { styles } from '@/components/pdf-editor/styles';
import { Icon, Txt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { WEB_GESTURE_STYLE } from '@/lib/pdf-editor/constants';
import type { EditorObject } from '@/lib/pdf-editor/types';

export function EditablePageObject({
  object,
  selected,
  accent,
  layout,
  onSelect,
  onPatch,
  onInteractionStateChange,
}: {
  object: EditorObject;
  selected: boolean;
  accent: string;
  layout: { width: number; height: number };
  onSelect: (object: EditorObject) => void;
  onPatch: (id: string, patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject)) => void;
  onInteractionStateChange: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const objectRef = useRef(object);
  const dragStart = useRef<EditorObject | null>(null);
  const pointerDrag = useRef<{ start: EditorObject; startX: number; startY: number } | null>(null);

  useEffect(() => {
    objectRef.current = object;
  }, [object]);

  const beginObjectDrag = (clientX: number, clientY: number) => {
    const latest = objectRef.current;
    pointerDrag.current = { start: latest, startX: clientX, startY: clientY };
    onSelect(latest);
    onInteractionStateChange(true);
  };

  const updateObjectDrag = (clientX: number, clientY: number) => {
    if (!pointerDrag.current) return;
    const dx = (clientX - pointerDrag.current.startX) / Math.max(1, layout.width);
    const dy = (clientY - pointerDrag.current.startY) / Math.max(1, layout.height);
    onPatch(objectRef.current.id, {
      x: pointerDrag.current.start.x + dx,
      y: pointerDrag.current.start.y + dy,
    });
  };

  const endObjectDrag = () => {
    pointerDrag.current = null;
    onInteractionStateChange(false);
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
            beginObjectDrag(native.clientX, native.clientY);
          },
          onPointerMove: (evt: unknown) => {
            if (!pointerDrag.current) return;
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              nativeEvent?: { clientX: number; clientY: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            updateObjectDrag(native.clientX, native.clientY);
          },
          onPointerUp: endObjectDrag,
          onPointerCancel: endObjectDrag,
          onLostPointerCapture: endObjectDrag,
        } as Record<string, unknown>)
      : {};

  const dragPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const latest = objectRef.current;
          dragStart.current = latest;
          onSelect(latest);
          onInteractionStateChange(true);
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!dragStart.current) return;
          const dx = gesture.dx / Math.max(1, layout.width);
          const dy = gesture.dy / Math.max(1, layout.height);
          onPatch(objectRef.current.id, { x: dragStart.current.x + dx, y: dragStart.current.y + dy });
        },
        onPanResponderRelease: () => {
          dragStart.current = null;
          onInteractionStateChange(false);
        },
        onPanResponderTerminate: () => {
          dragStart.current = null;
          onInteractionStateChange(false);
        },
      }),
    [layout.height, layout.width, onInteractionStateChange, onPatch, onSelect],
  );

  return (
    <View
      style={[
        styles.editorObject,
        WEB_GESTURE_STYLE,
        {
          left: `${object.x * 100}%`,
          top: `${object.y * 100}%`,
          width: `${object.width * 100}%`,
          height: `${object.height * 100}%`,
          borderColor: selected ? accent : withAlpha(object.color, 0.42),
          transform: [
            {
              rotate:
                object.type === 'text' ||
                object.type === 'highlight' ||
                object.type === 'redact' ||
                object.type === 'annotate'
                  ? '0deg'
                  : `${object.rotation}deg`,
            },
          ],
        },
      ]}
      {...dragPan.panHandlers}
      {...pointerHandlers}
    >
      <ObjectPreview object={object} selected={selected} accent={accent} />
      {selected ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.objectToolbar,
              { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
            ]}
          >
            <Icon name="cursor-move" size={14} color={accent} />
            <Txt variant="tiny">Drag</Txt>
          </View>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <ResizeHandle
              key={corner}
              corner={corner}
              object={object}
              layout={layout}
              accent={accent}
              onPatch={onPatch}
              onInteractionStateChange={onInteractionStateChange}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function resizeFromDelta(
  initial: EditorObject,
  dx: number,
  dy: number,
  corner: 'nw' | 'ne' | 'sw' | 'se',
): EditorObject {
  const next = { ...initial };
  if (corner.includes('e')) next.width = initial.width + dx;
  if (corner.includes('s')) next.height = initial.height + dy;
  if (corner.includes('w')) {
    next.x = initial.x + dx;
    next.width = initial.width - dx;
  }
  if (corner.includes('n')) {
    next.y = initial.y + dy;
    next.height = initial.height - dy;
  }
  return next;
}

function ResizeHandle({
  corner,
  object,
  layout,
  accent,
  onPatch,
  onInteractionStateChange,
}: {
  corner: 'nw' | 'ne' | 'sw' | 'se';
  object: EditorObject;
  layout: { width: number; height: number };
  accent: string;
  onPatch: (id: string, patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject)) => void;
  onInteractionStateChange: (dragging: boolean) => void;
}) {
  const start = useRef<EditorObject | null>(null);
  const pointerResize = useRef<{ start: EditorObject; startX: number; startY: number } | null>(null);
  const beginResize = (clientX: number, clientY: number) => {
    pointerResize.current = { start: object, startX: clientX, startY: clientY };
    onInteractionStateChange(true);
  };
  const updateResize = (clientX: number, clientY: number) => {
    if (!pointerResize.current) return;
    const dx = (clientX - pointerResize.current.startX) / Math.max(1, layout.width);
    const dy = (clientY - pointerResize.current.startY) / Math.max(1, layout.height);
    onPatch(object.id, resizeFromDelta(pointerResize.current.start, dx, dy, corner));
  };
  const endResize = () => {
    pointerResize.current = null;
    onInteractionStateChange(false);
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
            beginResize(native.clientX, native.clientY);
          },
          onPointerMove: (evt: unknown) => {
            if (!pointerResize.current) return;
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              nativeEvent?: { clientX: number; clientY: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            updateResize(native.clientX, native.clientY);
          },
          onPointerUp: endResize,
          onPointerCancel: endResize,
          onLostPointerCapture: endResize,
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
        onPanResponderGrant: () => {
          start.current = object;
          onInteractionStateChange(true);
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!start.current) return;
          const dx = gesture.dx / Math.max(1, layout.width);
          const dy = gesture.dy / Math.max(1, layout.height);
          onPatch(object.id, (current) => {
            const initial = start.current ?? current;
            return resizeFromDelta(initial, dx, dy, corner);
          });
        },
        onPanResponderRelease: () => {
          start.current = null;
          onInteractionStateChange(false);
        },
        onPanResponderTerminate: () => {
          start.current = null;
          onInteractionStateChange(false);
        },
      }),
    [corner, layout.height, layout.width, object, onInteractionStateChange, onPatch],
  );

  const handleStyles = {
    nw: styles.resizeHandle_nw,
    ne: styles.resizeHandle_ne,
    sw: styles.resizeHandle_sw,
    se: styles.resizeHandle_se,
  };
  return (
    <View
      {...pan.panHandlers}
      {...pointerHandlers}
      style={[styles.resizeHandle, handleStyles[corner], WEB_GESTURE_STYLE, { backgroundColor: accent }]}
    />
  );
}
