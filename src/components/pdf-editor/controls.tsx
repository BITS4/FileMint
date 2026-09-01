import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from '@/components/pdf-editor/styles';
import { Icon, Txt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';

export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.labeled}>
      <Txt variant="label" muted>
        {label}
      </Txt>
      {children}
    </View>
  );
}

export function ActionWrap({ children }: { children: ReactNode }) {
  return <View style={styles.actionWrap}>{children}</View>;
}

export function ActionButton({
  icon,
  label,
  onPress,
  accent,
  active,
}: {
  icon: string;
  label: string;
  onPress?: () => void;
  accent?: string;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: active
            ? withAlpha(accent ?? theme.primary, pressed ? 0.34 : 0.26)
            : accent
              ? withAlpha(accent, pressed ? 0.22 : 0.14)
              : theme.backgroundElement,
          borderColor: active ? (accent ?? theme.primary) : (accent ?? theme.border),
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <Icon
        name={icon}
        size={17}
        color={active ? (accent ?? theme.primary) : (accent ?? theme.textSecondary)}
      />
      <Txt variant="tiny" center style={styles.actionButtonLabel}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ColorSwatches({
  colors,
  active,
  onSelect,
  wrap,
}: {
  colors: string[];
  active: string;
  onSelect?: (color: string) => void;
  wrap?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.swatchRow, wrap ? styles.swatchRowWrap : null]}>
      {colors.map((color) => (
        <Pressable
          key={color}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${color}`}
          onPress={() => onSelect?.(color)}
          style={({ pressed }) => [
            styles.swatch,
            {
              backgroundColor: color,
              borderColor: color.toLowerCase() === active.toLowerCase() ? theme.primary : theme.borderStrong,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function PositionGrid({ active, accent }: { active: string; accent: string }) {
  const theme = useTheme();
  const cells = [
    'top-left',
    'top-center',
    'top-right',
    'middle-left',
    'center',
    'middle-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ];
  return (
    <View style={[styles.positionGrid, { borderColor: theme.border }]}>
      {cells.map((cell) => (
        <View
          key={cell}
          style={[
            styles.positionCell,
            {
              backgroundColor: cell === active ? withAlpha(accent, 0.28) : theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          {cell === active ? <View style={[styles.positionDot, { backgroundColor: accent }]} /> : null}
        </View>
      ))}
    </View>
  );
}

export function CheckRow({ label, checked }: { label: string; checked: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.checkRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Icon
        name={checked ? 'checkbox-marked-circle-outline' : 'checkbox-blank-circle-outline'}
        size={20}
        color={checked ? theme.primary : theme.textMuted}
      />
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

export function WarningBox({ title, text }: { title: string; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.warningBox,
        { backgroundColor: theme.warningMuted, borderColor: withAlpha(theme.warning, 0.45) },
      ]}
    >
      <Icon name="alert-outline" size={18} color={theme.warning} />
      <View style={{ flex: 1 }}>
        <Txt variant="label" style={{ color: theme.warning }}>
          {title}
        </Txt>
        <Txt variant="tiny" style={{ color: theme.warning }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}
