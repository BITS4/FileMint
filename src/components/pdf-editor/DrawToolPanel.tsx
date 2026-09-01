import { View } from 'react-native';

import { ActionButton, ActionWrap, ColorSwatches } from '@/components/pdf-editor/controls';
import type { ToolPanelProps } from '@/components/pdf-editor/panel-types';
import { styles } from '@/components/pdf-editor/styles';
import { Button, TextField } from '@/components/ui';
import { DOODLE_COLOR_SWATCHES } from '@/lib/pdf-editor/constants';
import type { EditorOptions } from '@/lib/pdf-editor/types';

export function DrawToolPanel({
  tool,
  accent,
  options,
  setOptions,
  onApply,
  saving,
  canApply,
}: ToolPanelProps) {
  const update = <K extends keyof EditorOptions>(key: K, value: EditorOptions[K]) =>
    setOptions((previous) => ({ ...previous, [key]: value }));
  const setDoodleMode = (mode: EditorOptions['doodleMode']) =>
    setOptions((previous) => {
      const presets: Record<EditorOptions['doodleMode'], Pick<EditorOptions, 'thickness' | 'opacity'>> = {
        pencil: { thickness: '4', opacity: '0.86' },
        marker: { thickness: '12', opacity: '0.45' },
        eraser: { thickness: '18', opacity: previous.opacity },
        vector: { thickness: '4', opacity: '1' },
        arrow: { thickness: '4', opacity: '1' },
      };
      return { ...previous, doodleMode: mode, ...presets[mode] };
    });

  if (tool === 'doodle') {
    return (
      <>
        <ActionWrap>
          <ActionButton
            icon="pencil-outline"
            label="Pencil"
            accent={accent}
            active={options.doodleMode === 'pencil'}
            onPress={() => setDoodleMode('pencil')}
          />
          <ActionButton
            icon="marker"
            label="Marker"
            accent={accent}
            active={options.doodleMode === 'marker'}
            onPress={() => setDoodleMode('marker')}
          />
          <ActionButton
            icon="eraser"
            label="Eraser"
            accent={accent}
            active={options.doodleMode === 'eraser'}
            onPress={() => setDoodleMode('eraser')}
          />
          <ActionButton
            icon="vector-line"
            label="Vector"
            accent={accent}
            active={options.doodleMode === 'vector'}
            onPress={() => setDoodleMode('vector')}
          />
          <ActionButton
            icon="arrow-top-right"
            label="Arrow"
            accent={accent}
            active={options.doodleMode === 'arrow'}
            onPress={() => setDoodleMode('arrow')}
          />
        </ActionWrap>
        <ColorSwatches
          colors={DOODLE_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField
              label="Stroke size"
              value={options.thickness}
              onChangeText={(value) => update('thickness', value)}
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
        <TextField
          label="Stroke color"
          value={options.color}
          onChangeText={(value) => update('color', value)}
        />
        <Button
          title="Apply Drawing Layer"
          icon="pencil-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'highlight') {
    return (
      <>
        <ColorSwatches
          colors={['#F7C948', '#2BD9A8', '#38BDF8', '#FB7185']}
          active={options.color}
          onSelect={(color) => update('color', color)}
        />
        <TextField
          label="Opacity"
          value={options.opacity}
          onChangeText={(value) => update('opacity', value)}
          keyboardType="decimal-pad"
        />
        <ActionWrap>
          <ActionButton icon="format-underline" label="Underline" />
          <ActionButton icon="format-strikethrough" label="Strike" />
          <ActionButton icon="gesture" label="Squiggle" />
        </ActionWrap>
        <Button
          title="Apply Highlight"
          icon="marker"
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
