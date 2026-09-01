import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { ActionButton, ActionWrap, ColorSwatches, Labeled } from '@/components/pdf-editor/controls';
import type { ToolPanelProps } from '@/components/pdf-editor/panel-types';
import { styles } from '@/components/pdf-editor/styles';
import { Button, Icon, Segmented, TextField, Txt } from '@/components/ui';
import { Accents } from '@/constants/theme';
import { withAlpha } from '@/lib/color';
import { STAMP_COLOR_SWATCHES, STAMP_TEMPLATES } from '@/lib/pdf-editor/constants';
import { fileExtensionFromName, mimeFromImageName } from '@/lib/pdf-editor/preview';
import type { EditorOptions } from '@/lib/pdf-editor/types';
import { pickImages } from '@/lib/pick';
import * as storage from '@/lib/storage';

export function StampToolPanel({ accent, options, setOptions, onApply, saving, canApply }: ToolPanelProps) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const update = <K extends keyof EditorOptions>(key: K, value: EditorOptions[K]) =>
    setOptions((previous) => ({ ...previous, [key]: value }));
  const chooseStampImage = async () => {
    setUploadBusy(true);
    setUploadError(null);
    try {
      const [picked] = await pickImages({ multiple: false });
      if (!picked) return;
      const extension = fileExtensionFromName(picked.name, picked.mime?.includes('jpeg') ? 'jpg' : 'png');
      const mime = mimeFromImageName(picked.name, picked.mime);
      const stored = await storage.importUri(picked.uri, extension);
      const uri = await storage.getDataUrl(stored.key, mime);
      setOptions((previous) => ({
        ...previous,
        stampMode: 'upload',
        stampImageDataUrl: uri,
        stampImageName: picked.name,
        opacity: '1',
        rotation: '0',
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not import this stamp image.');
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <>
      <Segmented
        options={[
          { label: 'Design', value: 'design' },
          { label: 'Upload', value: 'upload' },
        ]}
        value={options.stampMode}
        onChange={(value) => update('stampMode', value)}
      />
      {options.stampMode === 'design' ? (
        <>
          <View style={styles.stampGallery}>
            {STAMP_TEMPLATES.map((stamp) => (
              <Pressable
                key={stamp.label}
                onPress={() =>
                  setOptions((prev) => ({
                    ...prev,
                    stampMode: 'design',
                    stampText: stamp.label,
                    stampDetail: stamp.detail,
                    stampShape: stamp.shape,
                    stampStyle: stamp.style,
                    color: stamp.color,
                    opacity: stamp.style === 'filled' ? '0.82' : '0.92',
                    rotation: stamp.label === 'DRAFT' || stamp.label === 'CONFIDENTIAL' ? '-12' : '0',
                  }))
                }
                style={[
                  styles.stampChip,
                  stamp.shape === 'seal'
                    ? styles.stampChipSeal
                    : stamp.shape === 'pill'
                      ? styles.stampChipPill
                      : null,
                  {
                    borderColor: stamp.color,
                    backgroundColor: stamp.style === 'filled' ? withAlpha(stamp.color, 0.18) : 'transparent',
                  },
                ]}
              >
                <Txt variant="tiny" center style={{ color: stamp.color }}>
                  {stamp.label}
                </Txt>
              </Pressable>
            ))}
          </View>
          <TextField
            label="Custom stamp"
            value={options.stampText}
            onChangeText={(value) => update('stampText', value)}
          />
          <TextField
            label="Small text"
            value={options.stampDetail}
            onChangeText={(value) => update('stampDetail', value)}
          />
          <Labeled label="Shape">
            <ActionWrap>
              <ActionButton
                icon="rectangle-outline"
                label="Box"
                accent={accent}
                active={options.stampShape === 'box'}
                onPress={() => update('stampShape', 'box')}
              />
              <ActionButton
                icon="pill"
                label="Pill"
                accent={accent}
                active={options.stampShape === 'pill'}
                onPress={() => update('stampShape', 'pill')}
              />
              <ActionButton
                icon="seal"
                label="Seal"
                accent={accent}
                active={options.stampShape === 'seal'}
                onPress={() => update('stampShape', 'seal')}
              />
            </ActionWrap>
          </Labeled>
          <Labeled label="Style">
            <ActionWrap>
              <ActionButton
                icon="square-outline"
                label="Outline"
                accent={accent}
                active={options.stampStyle === 'outline'}
                onPress={() => update('stampStyle', 'outline')}
              />
              <ActionButton
                icon="checkbox-blank"
                label="Filled"
                accent={accent}
                active={options.stampStyle === 'filled'}
                onPress={() => update('stampStyle', 'filled')}
              />
              <ActionButton
                icon="checkbox-multiple-blank-outline"
                label="Double"
                accent={accent}
                active={options.stampStyle === 'double'}
                onPress={() => update('stampStyle', 'double')}
              />
            </ActionWrap>
          </Labeled>
        </>
      ) : (
        <>
          <View style={styles.stampUploadPad}>
            {options.stampImageDataUrl ? (
              <Image
                source={{ uri: options.stampImageDataUrl }}
                resizeMode="contain"
                style={styles.stampImagePreview}
              />
            ) : (
              <View style={styles.signaturePadEmpty}>
                <Icon name="image-plus" size={24} color={accent} />
                <Txt variant="caption" muted center>
                  Upload a PNG or JPG stamp, seal, logo, or scanned mark.
                </Txt>
              </View>
            )}
          </View>
          <Button
            title={options.stampImageDataUrl ? 'Replace Stamp Image' : 'Choose Stamp Image'}
            icon="image-plus"
            variant="secondary"
            onPress={chooseStampImage}
            loading={uploadBusy}
            full
          />
          {options.stampImageName ? (
            <Txt variant="tiny" muted>
              {options.stampImageName}
            </Txt>
          ) : null}
          {uploadError ? (
            <Txt variant="tiny" style={{ color: Accents.rose }}>
              {uploadError}
            </Txt>
          ) : null}
        </>
      )}
      <View style={styles.twoCols}>
        <View style={styles.twoColItem}>
          <TextField
            label="Rotation"
            value={options.rotation}
            onChangeText={(value) => update('rotation', value)}
            keyboardType="numbers-and-punctuation"
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
      <TextField label="Stamp color" value={options.color} onChangeText={(value) => update('color', value)} />
      <ColorSwatches
        colors={STAMP_COLOR_SWATCHES}
        active={options.color}
        onSelect={(color) => update('color', color)}
        wrap
      />
      <Button
        title="Place Stamp"
        icon="stamper"
        onPress={onApply}
        loading={saving}
        disabled={!canApply}
        full
      />
    </>
  );
}
