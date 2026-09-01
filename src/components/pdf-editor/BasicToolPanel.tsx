import { View } from 'react-native';

import type { ToolPanelProps } from '@/components/pdf-editor/panel-types';
import {
  ActionButton,
  ActionWrap,
  CheckRow,
  ColorSwatches,
  Labeled,
  PositionGrid,
  WarningBox,
} from '@/components/pdf-editor/controls';
import { styles } from '@/components/pdf-editor/styles';
import { Button, Segmented, TextField } from '@/components/ui';
import { TEXT_COLOR_SWATCHES } from '@/lib/pdf-editor/constants';
import type { EditorOptions } from '@/lib/pdf-editor/types';

export function BasicToolPanel({
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
  const toggle = (key: 'bold' | 'italic' | 'underline') =>
    setOptions((previous) => ({ ...previous, [key]: !previous[key] }));
  const setAlign = (align: EditorOptions['align']) => setOptions((previous) => ({ ...previous, align }));

  if (tool === 'add-page-numbers') {
    return (
      <>
        <Labeled label="Position">
          <PositionGrid active="bottom-center" accent={accent} />
        </Labeled>
        <TextField label="Format" value="Page {n} of {total}" onChangeText={() => undefined} />
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField label="Start" value="1" onChangeText={() => undefined} keyboardType="number-pad" />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Font size"
              value="12"
              onChangeText={() => undefined}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <ColorSwatches
          colors={['#EAF0F6', '#2BD9A8', '#3B82F6', '#FF5C5C']}
          active={options.color}
          onSelect={(color) => update('color', color)}
        />
        <Button
          title="Preview Page Numbers"
          icon="format-list-numbered"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'add-watermark') {
    return (
      <>
        <Segmented
          options={[
            { label: 'Text', value: 'text' },
            { label: 'Image', value: 'image' },
          ]}
          value="text"
          onChange={() => undefined}
        />
        <TextField label="Watermark" value={options.text} onChangeText={(value) => update('text', value)} />
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField
              label="Opacity"
              value={options.opacity}
              onChangeText={(value) => update('opacity', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Rotation"
              value={options.rotation}
              onChangeText={(value) => update('rotation', value)}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        <TextField
          label="Color"
          value={options.color}
          onChangeText={(value) => update('color', value)}
          placeholder="#2BD9A8"
        />
        <ColorSwatches
          colors={['#EAF0F6', '#2BD9A8', '#38BDF8', '#F7C948', '#FB7185']}
          active={options.color}
          onSelect={(color) => update('color', color)}
        />
        <Labeled label="Position">
          <PositionGrid active="center" accent={accent} />
        </Labeled>
        <ActionWrap>
          <ActionButton icon="grid" label="Tile" accent={accent} />
          <ActionButton icon="layers-outline" label="Behind text" />
        </ActionWrap>
        <Button
          title="Preview Watermark"
          icon="watermark"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'flatten') {
    return (
      <>
        <WarningBox
          title="Flatten preview"
          text="Flattened objects may no longer be editable after export."
        />
        {['Annotations', 'Forms', 'Signatures', 'Drawings', 'Stamps', 'Editable layers'].map(
          (item, index) => (
            <CheckRow key={item} label={item} checked={index < 4} />
          ),
        )}
        <Button
          title="Preview Flattened PDF"
          icon="layers-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'add-text') {
    return (
      <>
        <TextField label="Text" value={options.text} onChangeText={(value) => update('text', value)} />
        <ActionWrap>
          <ActionButton
            icon="format-bold"
            label="Bold"
            accent={accent}
            active={options.bold}
            onPress={() => toggle('bold')}
          />
          <ActionButton
            icon="format-italic"
            label="Italic"
            accent={accent}
            active={options.italic}
            onPress={() => toggle('italic')}
          />
          <ActionButton
            icon="format-underline"
            label="Underline"
            accent={accent}
            active={options.underline}
            onPress={() => toggle('underline')}
          />
          <ActionButton
            icon="format-align-left"
            label="Left"
            accent={accent}
            active={options.align === 'left'}
            onPress={() => setAlign('left')}
          />
          <ActionButton
            icon="format-align-center"
            label="Center"
            accent={accent}
            active={options.align === 'center'}
            onPress={() => setAlign('center')}
          />
          <ActionButton
            icon="format-align-right"
            label="Right"
            accent={accent}
            active={options.align === 'right'}
            onPress={() => setAlign('right')}
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
        <TextField label="Color" value={options.color} onChangeText={(value) => update('color', value)} />
        <ColorSwatches
          colors={TEXT_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <Button
          title="Add Another Text Box"
          icon="plus"
          variant="secondary"
          onPress={onAddObject}
          disabled={!canApply}
          full
        />
        <Button
          title="Preview PDF"
          icon="eye-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  return null;
}
