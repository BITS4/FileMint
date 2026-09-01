import { Pressable, View } from 'react-native';

import { ActionButton, ActionWrap, ColorSwatches, WarningBox } from '@/components/pdf-editor/controls';
import type { ToolPanelProps } from '@/components/pdf-editor/panel-types';
import { styles } from '@/components/pdf-editor/styles';
import { Button, Icon, TextField, Txt } from '@/components/ui';
import { withAlpha } from '@/lib/color';
import { ANNOTATE_COLOR_SWATCHES, FORM_FIELD_PRESETS } from '@/lib/pdf-editor/constants';
import type { EditorOptions } from '@/lib/pdf-editor/types';

export function AnnotationFormToolPanel({
  tool,
  accent,
  options,
  setOptions,
  onApply,
  onAddObject,
  saving,
  canApply,
}: ToolPanelProps) {
  const update = <K extends keyof EditorOptions>(key: K, value: EditorOptions[K]) =>
    setOptions((previous) => ({ ...previous, [key]: value }));
  const setAnnotationMode = (mode: EditorOptions['annotationMode']) =>
    setOptions((previous) => ({ ...previous, annotationMode: mode }));
  const addFormField = (kind: EditorOptions['formFieldKind']) => {
    const preset = FORM_FIELD_PRESETS.find((item) => item.kind === kind) ?? FORM_FIELD_PRESETS[0];
    onAddObject({
      formFieldKind: kind,
      formPlaceholder: preset.placeholder,
      formValue: preset.value,
      formChecked: kind === 'checkbox',
      formRequired: false,
      color: options.color || accent,
      opacity: '1',
      thickness: kind === 'checkbox' ? '2.4' : '1.6',
      rotation: '0',
    });
  };

  if (tool === 'annotate') {
    const quickNotes = ['Review missing date', 'Confirm signature', 'Resolve price note'];
    return (
      <>
        <TextField
          label="Comment text"
          value={options.annotationText}
          onChangeText={(value) => update('annotationText', value)}
        />
        <ColorSwatches
          colors={ANNOTATE_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <View style={styles.quickNoteGrid}>
          {quickNotes.map((note) => (
            <Pressable key={note} onPress={() => update('annotationText', note)} style={styles.quickNoteChip}>
              <Icon name="comment-text-outline" size={14} color={accent} />
              <Txt variant="tiny" numberOfLines={1}>
                {note}
              </Txt>
            </Pressable>
          ))}
        </View>
        <ActionWrap>
          <ActionButton
            icon="comment-plus-outline"
            label="Note"
            accent={accent}
            active={options.annotationMode === 'note'}
            onPress={() => setAnnotationMode('note')}
          />
          <ActionButton
            icon="arrow-top-right"
            label="Callout"
            accent={accent}
            active={options.annotationMode === 'callout'}
            onPress={() => setAnnotationMode('callout')}
          />
          <ActionButton
            icon="shape-outline"
            label="Shape"
            accent={accent}
            active={options.annotationMode === 'shape'}
            onPress={() => setAnnotationMode('shape')}
          />
        </ActionWrap>
        <Button
          title="Add Annotation Box"
          icon="plus"
          variant="secondary"
          onPress={onAddObject}
          disabled={!canApply}
          full
        />
        <Button
          title="Apply Annotations"
          icon="comment-edit-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'redact') {
    return (
      <>
        <TextField
          label="Search text"
          placeholder="Email, phone, ID, name..."
          onChangeText={() => undefined}
        />
        <TextField
          label="Redaction label"
          value={options.redactLabel}
          onChangeText={(value) => update('redactLabel', value)}
        />
        <ActionWrap>
          <ActionButton icon="email-outline" label="Emails" accent={accent} />
          <ActionButton icon="phone-outline" label="Phones" />
          <ActionButton icon="card-account-details-outline" label="IDs" />
          <ActionButton icon="selection-drag" label="Manual box" />
        </ActionWrap>
        <WarningBox title="Permanent redaction" text="Preview every redaction before export." />
        <Button
          title="Preview Redactions"
          icon="marker-cancel"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  return (
    <>
      <View style={styles.formFieldList}>
        {[
          ['Name', 'Text field'],
          ['Date', 'Date field'],
          ['Consent', 'Checkbox'],
          ['Signature', 'Signature line'],
        ].map(([name, kind], index) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            onPress={() =>
              addFormField(
                kind === 'Checkbox'
                  ? 'checkbox'
                  : kind === 'Date field'
                    ? 'date'
                    : kind === 'Signature line'
                      ? 'signature'
                      : 'text',
              )
            }
            style={({ pressed }) => [styles.formDetectedRow, { opacity: pressed ? 0.78 : 1 }]}
          >
            <View style={[styles.formDetectedIndex, { backgroundColor: withAlpha(accent, 0.18) }]}>
              <Txt variant="tiny" style={{ color: accent }}>
                {index + 1}
              </Txt>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="label" numberOfLines={1}>
                {name}
              </Txt>
              <Txt variant="tiny" muted numberOfLines={1}>
                {kind}
              </Txt>
            </View>
            <Icon name="plus" size={18} color={accent} />
          </Pressable>
        ))}
      </View>
      <ActionWrap>
        {FORM_FIELD_PRESETS.map((field) => (
          <ActionButton
            key={field.kind}
            icon={field.icon}
            label={field.label}
            accent={accent}
            active={options.formFieldKind === field.kind}
            onPress={() => addFormField(field.kind)}
          />
        ))}
      </ActionWrap>
      <TextField
        label="Field value"
        value={options.formValue}
        onChangeText={(value) => update('formValue', value)}
        placeholder="Value to place"
      />
      <TextField
        label="Placeholder / label"
        value={options.formPlaceholder}
        onChangeText={(value) => update('formPlaceholder', value)}
        placeholder="Field label"
      />
      <ActionWrap>
        <ActionButton
          icon="asterisk"
          label="Required"
          accent={accent}
          active={options.formRequired}
          onPress={() => update('formRequired', !options.formRequired)}
        />
        <ActionButton
          icon="checkbox-marked-outline"
          label="Checked"
          accent={accent}
          active={options.formChecked}
          onPress={() => update('formChecked', !options.formChecked)}
        />
        <ActionButton
          icon="form-textbox-password"
          label="Clear value"
          accent={accent}
          onPress={() => update('formValue', '')}
        />
      </ActionWrap>
      <View style={styles.twoCols}>
        <View style={styles.twoColItem}>
          <TextField
            label="Font size"
            value={options.fontSize}
            onChangeText={(value) => update('fontSize', value)}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.twoColItem}>
          <TextField
            label="Opacity"
            value={options.opacity}
            onChangeText={(value) => update('opacity', value)}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
      <TextField label="Field color" value={options.color} onChangeText={(value) => update('color', value)} />
      <ColorSwatches
        colors={['#2563EB', '#2BD9A8', '#111827', '#374151', '#EF4444', '#F7C948', '#8B5CF6', '#EAF0F6']}
        active={options.color}
        onSelect={(color) => update('color', color)}
        wrap
      />
      <Button
        title="Preview Filled Form"
        icon="form-select"
        onPress={onApply}
        loading={saving}
        disabled={!canApply}
        full
      />
    </>
  );
}
