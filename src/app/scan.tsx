import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, Button, EmptyState, Icon, Screen, Thumbnail, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';
import { prepareImageForPdf } from '@/lib/image';
import { goBack } from '@/lib/nav';
import { imagesToPdf } from '@/lib/pdf';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

export default function ScanScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [pages, setPages] = useState<FileItem[]>([]);
  const [busy, setBusy] = useState(false);

  const title =
    mode === 'id'
      ? 'Scan ID Card'
      : mode === 'passport'
        ? 'Scan Passport'
        : mode === 'batch'
          ? 'Batch Scan'
          : 'Smart Scan';
  const framed = mode === 'id' || mode === 'passport';

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
    if (!photo?.uri) return;
    haptics.tap();
    const file = await useLibrary.getState().importPicked({
      uri: photo.uri,
      name: `scan-${Date.now()}.jpg`,
      mime: 'image/jpeg',
      source: 'scan',
    });
    setPages((prev) => [...prev, file]);
  };

  const create = async () => {
    if (pages.length === 0) return;
    setBusy(true);
    try {
      const prepared = [];
      for (const p of pages) prepared.push(await prepareImageForPdf(p.storageKey, p.ext));
      const pdf = await imagesToPdf(prepared, { pageSize: 'a4', orientation: 'portrait', margin: 24 });
      const file = await useLibrary.getState().saveResult({
        bytes: pdf,
        name: `${title} ${new Date().toLocaleDateString()}.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'scan',
        pageCount: pages.length,
      });
      haptics.success();
      router.replace(`/viewer/${file.id}`);
    } catch {
      haptics.error();
      setBusy(false);
    }
  };

  if (!permission) {
    return (
      <Screen padded>
        <AppHeader title={title} showBack />
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen padded>
        <AppHeader title={title} showBack />
        <EmptyState
          icon="camera-outline"
          title="Camera access needed"
          subtitle="FileMint uses the camera to scan documents into PDFs. Your photos stay on your device."
          actionLabel="Allow camera"
          onAction={requestPermission}
        />
      </Screen>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#000' }]}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {framed ? (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={[styles.frame, { borderColor: theme.primary }]} />
          <Txt variant="caption" style={styles.frameHint}>
            Align the {mode === 'passport' ? 'passport' : 'card'} inside the frame
          </Txt>
        </View>
      ) : null}

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={goBack} hitSlop={10} style={styles.iconBtn}>
          <Icon name="chevron-left" size={28} color="#fff" />
        </Pressable>
        <Txt variant="h3" style={{ color: '#fff' }}>
          {title}
        </Txt>
        <View style={{ width: 28 }} />
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.md }]}>
        {pages.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {pages.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setPages((prev) => prev.filter((f) => f.id !== p.id))}
                style={styles.thumb}
              >
                <Thumbnail file={p} size={56} radius={Radius.sm} />
                <View style={styles.thumbRemove}>
                  <Icon name="close" size={12} color="#fff" />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Txt variant="caption" style={styles.tip}>
            Capture each page, then create your PDF.
          </Txt>
        )}

        <View style={styles.controls}>
          <View style={styles.sideSlot} />
          <Pressable
            onPress={capture}
            disabled={busy}
            style={[styles.shutter, { borderColor: theme.primary }]}
          >
            <View style={[styles.shutterInner, { backgroundColor: theme.primary }]} />
          </Pressable>
          <View style={styles.sideSlot}>
            {pages.length > 0 ? (
              <Button
                title={`PDF (${pages.length})`}
                onPress={create}
                loading={busy}
                size="sm"
                icon="check"
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  iconBtn: { width: 28, alignItems: 'flex-start' },
  frameWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { width: '82%', aspectRatio: 1.586, borderWidth: 3, borderRadius: Radius.lg, borderStyle: 'dashed' },
  frameHint: { color: '#fff', marginTop: Spacing.md, textShadowColor: '#000', textShadowRadius: 4 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  strip: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  thumb: { borderRadius: Radius.sm },
  thumbRemove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF5C5C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tip: { color: '#fff', textAlign: 'center', marginBottom: Spacing.md, opacity: 0.85 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
  },
  sideSlot: { width: 96, alignItems: 'center' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 54, height: 54, borderRadius: 27 },
});
