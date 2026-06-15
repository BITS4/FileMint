import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button } from './Button';
import { TextField } from './TextField';
import { Txt } from './Txt';

export interface PromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function PromptModal({
  visible,
  title,
  message,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  onSubmit,
  onClose,
}: PromptModalProps) {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          <Txt variant="h3">{title}</Txt>
          {message ? (
            <Txt variant="caption" muted style={styles.message}>
              {message}
            </Txt>
          ) : null}
          <View style={styles.field}>
            <TextField
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              autoFocus
              onSubmitEditing={() => onSubmit(value)}
            />
          </View>
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex} />
            <Button title={submitLabel} onPress={() => onSubmit(value)} style={styles.flex} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card: { width: '100%', maxWidth: 420, borderRadius: Radius.xl, borderWidth: 1, padding: Spacing.lg },
  message: { marginTop: 4 },
  field: { marginTop: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  flex: { flex: 1 },
});
