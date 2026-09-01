import { useState } from 'react';
import { Image, View } from 'react-native';

import { ColorSwatches } from '@/components/pdf-editor/controls';
import type { ToolPanelProps } from '@/components/pdf-editor/panel-types';
import { SignatureDrawPad } from '@/components/pdf-editor/SignatureDrawPad';
import { styles } from '@/components/pdf-editor/styles';
import { Button, Icon, Segmented, TextField, Txt } from '@/components/ui';
import { Accents } from '@/constants/theme';
import { SIGNATURE_COLOR_SWATCHES } from '@/lib/pdf-editor/constants';
import { parsePositiveNumber } from '@/lib/pdf-editor/geometry';
import { fileExtensionFromName, mimeFromImageName } from '@/lib/pdf-editor/preview';
import type { EditorOptions } from '@/lib/pdf-editor/types';
import { pickImages } from '@/lib/pick';
import * as storage from '@/lib/storage';

export function SignatureToolPanel({
  accent,
  options,
  setOptions,
  onApply,
  saving,
  canApply,
}: ToolPanelProps) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const update = <K extends keyof EditorOptions>(key: K, value: EditorOptions[K]) =>
    setOptions((previous) => ({ ...previous, [key]: value }));
  const setSignatureMode = (mode: EditorOptions['signatureMode']) =>
    setOptions((previous) => ({
      ...previous,
      signatureMode: mode,
      opacity: mode === 'draw' || mode === 'upload' ? '1' : previous.opacity,
      thickness: mode === 'draw' ? '2' : previous.thickness,
      rotation: mode === 'type' ? previous.rotation : '0',
    }));
  const chooseSignatureImage = async () => {
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
        signatureMode: 'upload',
        signatureImageDataUrl: uri,
        signatureImageName: picked.name,
        opacity: '1',
        rotation: '0',
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not import this signature image.');
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <>
      <Segmented
        options={[
          { label: 'Draw', value: 'draw' },
          { label: 'Type', value: 'type' },
          { label: 'Upload', value: 'upload' },
        ]}
        value={options.signatureMode}
        onChange={(value) => setSignatureMode(value)}
      />
      {options.signatureMode === 'draw' ? (
        <>
          <SignatureDrawPad
            paths={options.signaturePaths}
            color={options.color}
            thickness={parsePositiveNumber(options.thickness, 2, 1, 10)}
            onChange={(paths) =>
              setOptions((prev) => ({
                ...prev,
                signaturePaths: paths,
                signaturePoints: paths[paths.length - 1] ?? [],
              }))
            }
          />
          <View style={styles.twoCols}>
            <View style={styles.twoColItem}>
              <TextField
                label="Pen size"
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
          <Button
            title="Clear Drawing"
            icon="eraser"
            variant="secondary"
            onPress={() => setOptions((prev) => ({ ...prev, signaturePaths: [], signaturePoints: [] }))}
            full
          />
        </>
      ) : null}
      {options.signatureMode === 'type' ? (
        <>
          <View style={[styles.signaturePad, styles.signatureTypedPad]}>
            <Txt
              variant="h2"
              style={{
                color: options.color,
                fontStyle: 'italic',
                fontSize: parsePositiveNumber(options.signatureFontSize, 24, 8, 96),
              }}
            >
              {options.signatureText || 'Signature'}
            </Txt>
          </View>
          <TextField
            label="Typed signature"
            value={options.signatureText}
            onChangeText={(value) => update('signatureText', value)}
          />
          <View style={styles.twoCols}>
            <View style={styles.twoColItem}>
              <TextField
                label="Type size"
                value={options.signatureFontSize}
                onChangeText={(value) => update('signatureFontSize', value)}
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
        </>
      ) : null}
      {options.signatureMode === 'upload' ? (
        <>
          <View style={styles.signaturePad}>
            {options.signatureImageDataUrl ? (
              <Image
                source={{ uri: options.signatureImageDataUrl }}
                resizeMode="contain"
                style={styles.signatureImagePreview}
              />
            ) : (
              <View style={styles.signaturePadEmpty}>
                <Icon name="image-plus" size={24} color={accent} />
                <Txt variant="caption" muted center>
                  Upload a transparent PNG or JPG signature.
                </Txt>
              </View>
            )}
          </View>
          <Button
            title={options.signatureImageDataUrl ? 'Replace Image' : 'Choose Image'}
            icon="image-plus"
            variant="secondary"
            onPress={chooseSignatureImage}
            loading={uploadBusy}
            full
          />
          {options.signatureImageName ? (
            <Txt variant="tiny" muted>
              {options.signatureImageName}
            </Txt>
          ) : null}
          {uploadError ? (
            <Txt variant="tiny" style={{ color: Accents.rose }}>
              {uploadError}
            </Txt>
          ) : null}
          <TextField
            label="Opacity"
            value={options.opacity}
            onChangeText={(value) => update('opacity', value)}
            keyboardType="decimal-pad"
          />
        </>
      ) : null}
      <TextField
        label="Rotation"
        value={options.rotation}
        onChangeText={(value) => update('rotation', value)}
        keyboardType="numbers-and-punctuation"
      />
      <TextField label="Ink color" value={options.color} onChangeText={(value) => update('color', value)} />
      <ColorSwatches
        colors={SIGNATURE_COLOR_SWATCHES}
        active={options.color}
        onSelect={(color) => update('color', color)}
        wrap
      />
      <Button
        title="Place Signature"
        icon="draw"
        onPress={onApply}
        loading={saving}
        disabled={!canApply}
        full
      />
    </>
  );
}
