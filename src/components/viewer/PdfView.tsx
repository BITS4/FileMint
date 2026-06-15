import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as storage from '@/lib/storage';

export interface PdfViewProps {
  storageKey: string;
  night?: boolean;
}

/**
 * Native PDF rendering via WebView. iOS renders PDFs inline; on Android the
 * platform WebView may not, in which case the viewer screen's Share/Download action
 * hands the file to an external viewer.
 */
export function PdfView({ storageKey, night }: PdfViewProps) {
  const theme = useTheme();
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    setFailed(undefined);
    storage.getUri(storageKey).then(setUri).catch(() => setFailed('Preview could not open this file.'));
  }, [storageKey]);

  if (failed) {
    return (
      <View style={[styles.center, { backgroundColor: night ? '#111827' : '#ffffff' }]}>
        <Txt variant="caption" muted center>
          {failed}
        </Txt>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={[styles.center, { backgroundColor: night ? '#111827' : '#ffffff' }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.shell, { backgroundColor: night ? '#111827' : '#F6F8FB' }]}>
      <WebView
        source={{ uri }}
        style={styles.webview}
        containerStyle={styles.webviewContainer}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        scalesPageToFit
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        textZoom={100}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.loadingOverlay, { backgroundColor: night ? '#111827' : '#F6F8FB' }]}>
            <ActivityIndicator color={theme.primary} />
          </View>
        )}
        onError={(event) => setFailed(event.nativeEvent.description || 'Preview could not open this file.')}
        onHttpError={(event) => setFailed(`Preview failed (${event.nativeEvent.statusCode}).`)}
        {...(Platform.OS === 'ios' ? { decelerationRate: 'normal' as const } : null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minWidth: 0 },
  webviewContainer: { flex: 1, minWidth: 0 },
  webview: { flex: 1, minWidth: 0, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  loadingOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
