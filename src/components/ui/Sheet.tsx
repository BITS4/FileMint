import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

import { Icon } from './Icon';
import { Txt } from './Txt';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElevated,
              borderColor: theme.border,
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.borderStrong }]} />
          {title ? (
            <Txt variant="h3" style={styles.title}>
              {title}
            </Txt>
          ) : null}
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export interface SheetAction {
  label: string;
  icon: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ActionSheet({
  visible,
  onClose,
  title,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: SheetAction[];
}) {
  const theme = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.actions}>
        {actions.map((action) => {
          const color = action.destructive ? theme.danger : theme.text;
          return (
            <Pressable
              key={action.label}
              disabled={action.disabled}
              onPress={() => {
                if (action.disabled) return;
                haptics.tap();
                onClose();
                action.onPress();
              }}
              style={({ pressed }) => [
                styles.action,
                {
                  backgroundColor: pressed ? theme.backgroundElement : 'transparent',
                  opacity: action.disabled ? 0.4 : 1,
                },
              ]}
            >
              <Icon name={action.icon} size={22} color={color} />
              <Txt variant="body" weight="600" style={{ color }}>
                {action.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    maxHeight: '82%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
  title: { marginBottom: Spacing.md },
  actions: { gap: 2, paddingBottom: Spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
});
