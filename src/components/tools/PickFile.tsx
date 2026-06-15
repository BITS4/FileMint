import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import type { FileItem, FileKind } from '@/types';

import { LibrarySheet } from './LibrarySheet';

export interface PickFileProps {
  onPicked: (file: FileItem) => void;
  kinds?: FileKind[];
  deviceTypes?: string | string[];
  title?: string;
  subtitle?: string;
  icon?: string;
}

export function PickFile({
  onPicked,
  kinds = ['pdf'],
  deviceTypes = 'application/pdf',
  title = 'Select a PDF',
  subtitle = 'Import from your device or choose one already in FileMint.',
  icon = 'file-pdf-box',
}: PickFileProps) {
  const theme = useTheme();
  const [sheet, setSheet] = useState(false);

  const importDevice = async () => {
    const picked = await pickDocuments({ type: deviceTypes });
    if (picked[0]) {
      const file = await importIntoLibrary(picked[0]);
      onPicked(file);
    }
  };

  return (
    <Card style={{ alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl }}>
      <View style={[styles.icon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
        <Icon name={icon} size={34} color={theme.primary} />
      </View>
      <Txt variant="h3" center>
        {title}
      </Txt>
      <Txt variant="caption" muted center style={styles.subtitle}>
        {subtitle}
      </Txt>
      <View style={styles.actions}>
        <Button title="Import from device" icon="upload" onPress={importDevice} full />
        <Button title="Choose from FileMint" icon="folder-outline" variant="secondary" onPress={() => setSheet(true)} full />
      </View>
      <LibrarySheet
        visible={sheet}
        kinds={kinds}
        onPick={(file) => {
          setSheet(false);
          onPicked(file);
        }}
        onClose={() => setSheet(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  icon: { width: 72, height: 72, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  subtitle: { maxWidth: 320, marginBottom: Spacing.sm },
  actions: { width: '100%', gap: Spacing.sm },
});
