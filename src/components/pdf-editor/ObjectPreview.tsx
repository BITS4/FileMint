import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { styles } from '@/components/pdf-editor/styles';
import { Icon, Txt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { clampUnit } from '@/lib/pdf-editor/model';
import type { EditorObject, EditorPoint } from '@/lib/pdf-editor/types';

export function ObjectPreview({
  object,
  selected,
  accent,
}: {
  object: EditorObject;
  selected: boolean;
  accent: string;
}) {
  const theme = useTheme();
  if (object.type === 'highlight') {
    return (
      <View
        style={[
          styles.objectFill,
          {
            backgroundColor: withAlpha(object.color, Math.min(0.58, object.opacity)),
            borderColor: object.color,
          },
        ]}
      />
    );
  }
  if (object.type === 'redact') {
    return (
      <View style={[styles.objectFill, styles.redactionFill]}>
        <Txt variant="tiny" center style={{ color: '#FFFFFF' }}>
          {object.text || 'Redacted'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'annotate') {
    if (object.annotationMode === 'shape') {
      return <View style={[styles.objectFill, styles.annotationShapeFill, { borderColor: object.color }]} />;
    }
    return (
      <View
        style={[
          styles.objectFill,
          styles.annotationFill,
          object.annotationMode === 'callout' ? styles.annotationCalloutFill : null,
          { borderColor: object.color },
        ]}
      >
        {object.annotationMode === 'callout' ? (
          <View style={[styles.calloutPointer, { backgroundColor: object.color }]} />
        ) : null}
        <Txt variant="tiny" style={{ color: '#111827' }}>
          {object.text || 'Review note'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'stamp') {
    if (object.stampMode === 'upload') {
      return (
        <View style={[styles.objectFill, styles.stampUploadFill, { borderColor: object.color }]}>
          {object.stampImageDataUrl ? (
            <Image
              source={{ uri: object.stampImageDataUrl }}
              resizeMode="contain"
              style={styles.stampImagePreview}
            />
          ) : (
            <View style={styles.signaturePadEmpty}>
              <Icon name="image-plus" size={18} color={object.color} />
              <Txt variant="tiny" center muted>
                Uploaded stamp
              </Txt>
            </View>
          )}
        </View>
      );
    }
    const filled = object.stampStyle === 'filled';
    const double = object.stampStyle === 'double';
    const shapeStyle =
      object.stampShape === 'seal'
        ? styles.stampSealFill
        : object.stampShape === 'pill'
          ? styles.stampPillFill
          : null;
    return (
      <View
        style={[
          styles.objectFill,
          styles.stampFill,
          shapeStyle,
          {
            borderColor: object.color,
            backgroundColor: filled
              ? withAlpha(object.color, Math.min(0.22, object.opacity * 0.22))
              : withAlpha(object.color, 0.035),
          },
        ]}
      >
        {double ? (
          <View
            pointerEvents="none"
            style={[styles.stampInnerBorder, shapeStyle, { borderColor: withAlpha(object.color, 0.72) }]}
          />
        ) : null}
        {object.stampShape === 'seal' ? (
          <Icon name="star-four-points-outline" size={16} color={object.color} />
        ) : null}
        <Txt variant="label" center numberOfLines={1} style={{ color: object.color }}>
          {(object.text || 'APPROVED').toUpperCase()}
        </Txt>
        <Txt variant="tiny" center numberOfLines={1} style={{ color: withAlpha(object.color, 0.82) }}>
          {(object.stampDetail || 'VERIFIED').toUpperCase()}
        </Txt>
      </View>
    );
  }
  if (object.type === 'signature') {
    const signaturePaths = object.signaturePaths?.length
      ? object.signaturePaths
      : object.signaturePoints?.length
        ? [object.signaturePoints]
        : [];
    if (object.signatureMode === 'draw') {
      return (
        <View style={[styles.objectFill, styles.signatureFill, { borderColor: object.color }]}>
          {signaturePaths.length ? (
            <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 100 100">
              {signaturePaths.map((path, index) => (
                <Path
                  key={`${index}-${path.length}`}
                  d={pathFromPoints(path, { width: 100, height: 100 })}
                  stroke={object.color}
                  strokeWidth={Math.max(1.2, Math.min(10, object.thickness))}
                  strokeOpacity={object.opacity}
                  fill="transparent"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          ) : (
            <Txt variant="tiny" center muted>
              Draw signature
            </Txt>
          )}
        </View>
      );
    }
    if (object.signatureMode === 'upload') {
      return (
        <View style={[styles.objectFill, styles.signatureFill, { borderColor: object.color }]}>
          {object.signatureImageDataUrl ? (
            <Image
              source={{ uri: object.signatureImageDataUrl }}
              resizeMode="contain"
              style={styles.signatureObjectImage}
            />
          ) : (
            <Txt variant="tiny" center muted>
              Upload signature
            </Txt>
          )}
        </View>
      );
    }
    return (
      <View style={[styles.objectFill, styles.signatureFill, { borderColor: object.color }]}>
        <Txt
          variant="h3"
          center
          style={{ color: object.color, fontStyle: 'italic', fontSize: object.fontSize ?? 24 }}
        >
          {object.text || 'Signature'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'watermark') {
    return (
      <View style={[styles.objectFill, styles.watermarkFill]}>
        <Txt
          variant="title"
          center
          style={{ color: withAlpha(object.color, Math.min(0.72, object.opacity)) }}
        >
          {object.text || 'CONFIDENTIAL'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'form-field') {
    const kind = object.formFieldKind ?? 'text';
    const label =
      object.formValue || object.formPlaceholder || (kind === 'checkbox' ? 'Checked' : 'Form field');
    if (kind === 'checkbox') {
      return (
        <View
          style={[
            styles.objectFill,
            styles.formCheckboxFill,
            { borderColor: object.color, backgroundColor: withAlpha(object.color, 0.05) },
          ]}
        >
          <View
            style={[
              styles.formCheckboxBox,
              {
                borderColor: object.color,
                backgroundColor: object.formChecked ? withAlpha(object.color, 0.18) : 'transparent',
              },
            ]}
          >
            {object.formChecked ? <Icon name="check-bold" size={18} color={object.color} /> : null}
          </View>
          <Txt variant="tiny" numberOfLines={1} style={{ color: object.color }}>
            {object.formPlaceholder || 'Checkbox'}
          </Txt>
        </View>
      );
    }
    if (kind === 'signature') {
      return (
        <View style={[styles.objectFill, styles.formSignatureFill, { borderColor: object.color }]}>
          <Txt variant="label" center numberOfLines={1} style={{ color: object.color, fontStyle: 'italic' }}>
            {object.formValue || 'Signature'}
          </Txt>
          <View style={[styles.formSignatureLine, { backgroundColor: withAlpha(object.color, 0.76) }]} />
        </View>
      );
    }
    return (
      <View
        style={[
          styles.objectFill,
          styles.formFieldFill,
          { borderColor: object.color, backgroundColor: withAlpha(theme.background, selected ? 0.84 : 0.66) },
        ]}
      >
        <View style={styles.formFieldTopRow}>
          <Txt variant="tiny" numberOfLines={1} style={{ color: object.color }}>
            {kind === 'date'
              ? 'Date'
              : kind === 'initials'
                ? 'Initials'
                : object.formRequired
                  ? 'Required'
                  : 'Text'}
          </Txt>
          {object.formRequired ? <Icon name="asterisk" size={12} color={object.color} /> : null}
        </View>
        <Txt
          variant="label"
          numberOfLines={1}
          style={{ color: object.formValue ? theme.text : theme.textMuted }}
        >
          {label}
        </Txt>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.objectFill,
        styles.textFill,
        {
          backgroundColor: withAlpha(theme.background, selected ? 0.78 : 0.56),
          borderColor: selected ? accent : withAlpha(object.color, 0.5),
        },
      ]}
    >
      <Txt
        variant="label"
        style={{
          color: object.color,
          fontWeight: object.bold ? '800' : '500',
          fontStyle: object.italic ? 'italic' : 'normal',
          fontSize: object.fontSize ?? 14,
          textDecorationLine: object.underline ? 'underline' : 'none',
          textAlign: object.align ?? 'left',
          width: '100%',
        }}
      >
        {object.text || 'Editable text'}
      </Txt>
    </View>
  );
}

export function pathFromPoints(points: EditorPoint[], layout: { width: number; height: number }) {
  if (!points.length) return '';
  return points
    .map((point, index) => {
      const x = clampUnit(point.x) * layout.width;
      const y = clampUnit(point.y) * layout.height;
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

function endPoints(points: EditorPoint[]) {
  if (points.length < 2) return points;
  return [points[0], points[points.length - 1]];
}

export function pathFromDoodleObject(object: EditorObject, layout: { width: number; height: number }) {
  const points = object.points ?? [];
  if (object.doodleMode === 'vector' || object.doodleMode === 'arrow')
    return pathFromPoints(endPoints(points), layout);
  return pathFromPoints(points, layout);
}

export function arrowHeadPath(points: EditorPoint[], layout: { width: number; height: number }) {
  const endpoints = endPoints(points);
  if (endpoints.length < 2) return '';
  const start = { x: endpoints[0].x * layout.width, y: endpoints[0].y * layout.height };
  const end = { x: endpoints[1].x * layout.width, y: endpoints[1].y * layout.height };
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = Math.max(14, Math.min(34, Math.hypot(end.x - start.x, end.y - start.y) * 0.22));
  const spread = Math.PI / 7;
  const left = { x: end.x - Math.cos(angle - spread) * size, y: end.y - Math.sin(angle - spread) * size };
  const right = { x: end.x - Math.cos(angle + spread) * size, y: end.y - Math.sin(angle + spread) * size };
  return `M${left.x} ${left.y} L${end.x} ${end.y} L${right.x} ${right.y}`;
}
