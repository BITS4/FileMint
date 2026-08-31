import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './Icon';
import { Txt } from './Txt';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  icon?: string;
  hint?: string;
}

export function TextField({ label, icon, hint, style, multiline, ...rest }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {label ? (
        <Txt variant="label" muted style={styles.label}>
          {label}
        </Txt>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
          multiline && styles.multiline,
        ]}
      >
        {icon ? <Icon name={icon} size={18} color={theme.textMuted} /> : null}
        <TextInput
          placeholderTextColor={theme.textMuted}
          multiline={multiline}
          style={[styles.input, { color: theme.text }, multiline && styles.inputMultiline, style]}
          {...rest}
        />
      </View>
      {hint ? (
        <Txt variant="tiny" muted style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs, flexShrink: 1, minWidth: 0 },
  label: { marginLeft: 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 50,
    minWidth: 0,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: Spacing.sm },
  input: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '500', paddingVertical: Spacing.sm },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },
  hint: { marginLeft: 2 },
});
