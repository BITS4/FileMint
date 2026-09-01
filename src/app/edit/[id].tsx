import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, TextInput, View } from 'react-native';

import { CollaboraEditor, type CollaboraEditorHandle } from '@/components/viewer/CollaboraEditor';
import { AppHeader, Button, EmptyState, Icon, Screen, Txt } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  closeEdit,
  downloadEdited,
  getEditorLaunch,
  getEditVersion,
  uploadForEdit,
  type EditorLaunch,
} from '@/lib/api';
import { goBack } from '@/lib/nav';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import * as storage from '@/lib/storage';
import { decodeUtf8, encodeUtf8 } from '@/lib/text';
import { useLibrary } from '@/store/useLibrary';
import type { FileKind } from '@/types';

const OFFICE: FileKind[] = ['word', 'excel', 'ppt'];
const TEXTY: FileKind[] = ['text', 'csv'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const file = useLibrary((s) => s.files.find((f) => f.id === id));
  const replaceFileBytes = useLibrary((s) => s.replaceFileBytes);

  const [text, setText] = useState<string | null>(null);
  const [editorLaunch, setEditorLaunch] = useState<EditorLaunch | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const session = useRef<{ id: string; token: string } | null>(null);
  const editorRef = useRef<CollaboraEditorHandle>(null);

  const isText = file ? TEXTY.includes(file.kind) : false;
  const isOffice = file ? OFFICE.includes(file.kind) : false;
  const shareSupported = canShareFiles();

  useEffect(() => {
    if (file && isText) {
      storage
        .readBytes(file.storageKey)
        .then((bytes) => setText(decodeUtf8(bytes)))
        .catch(() => setText(''));
    }
  }, [file, isText]);

  useEffect(() => {
    if (!file || !isOffice || Platform.OS !== 'web') return;
    let alive = true;
    (async () => {
      try {
        setError(undefined);
        setEditorLaunch(undefined);
        const uri = await storage.getUri(file.storageKey);
        const origin = typeof window !== 'undefined' ? window.location.origin : '*';
        const s = await uploadForEdit(uri, file.name, file.mime, origin);
        if (!alive) {
          void closeEdit(s.id, s.token);
          return;
        }
        session.current = { id: s.id, token: s.token };
        const launch = await getEditorLaunch(s.id, s.token);
        if (!alive) {
          void closeEdit(s.id, s.token);
          return;
        }
        setEditorLaunch(launch);
      } catch (e) {
        const s = session.current;
        if (s) {
          void closeEdit(s.id, s.token);
          session.current = null;
        }
        if (alive) setError(e instanceof Error ? e.message : 'Could not open the editor.');
      }
    })();
    return () => {
      alive = false;
      const s = session.current;
      if (s) void closeEdit(s.id, s.token);
    };
  }, [file, isOffice, retryKey]);

  const saveText = async () => {
    if (!file || text === null) return;
    setBusy(true);
    await replaceFileBytes(file.id, encodeUtf8(text));
    setBusy(false);
    goBack();
  };

  const saveOffice = async () => {
    const s = session.current;
    if (!s || !file) {
      goBack();
      return;
    }
    setBusy(true);
    setSaveError(undefined);
    try {
      const base = await getEditVersion(s.id, s.token);
      const before = await storage.readBytes(file.storageKey);
      await (editorRef.current?.save() ?? Promise.resolve({ confirmed: false, hadEdits: false }));
      let version = base;
      for (let i = 0; i < 12 && version <= base; i++) {
        await sleep(700);
        version = await getEditVersion(s.id, s.token);
      }

      const bytes = await downloadEdited(s.id, s.token);
      if (version <= base && sameBytes(before, bytes)) {
        throw new Error(
          'FileMint did not receive changed bytes from the editor. Use File > Save inside the editor, wait a moment, then press Save & Close again.',
        );
      }

      await replaceFileBytes(file.id, bytes);
      await closeEdit(s.id, s.token);
      session.current = null;
      setBusy(false);
      goBack();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The edited file could not be saved.');
      setBusy(false);
    }
  };

  const closeAndBack = () => {
    const s = session.current;
    if (s) void closeEdit(s.id, s.token);
    goBack();
  };

  const retryEditor = () => {
    setSaveError(undefined);
    setError(undefined);
    setEditorLaunch(undefined);
    setRetryKey((value) => value + 1);
  };

  const openHostedEditor = () => {
    if (!editorLaunch?.url || Platform.OS !== 'web') return;
    window.open(editorLaunch.url, '_blank', 'noopener,noreferrer');
  };

  if (!file) {
    return (
      <Screen padded>
        <AppHeader showBack />
        <EmptyState
          icon="file-remove-outline"
          title="File unavailable"
          actionLabel="Go back"
          onAction={goBack}
        />
      </Screen>
    );
  }

  if (!isText && !isOffice) {
    return (
      <Screen padded>
        <AppHeader title={file.name} showBack />
        <EmptyState
          icon="pencil-off-outline"
          title="Not editable"
          subtitle={`${file.ext.toUpperCase()} files can't be edited in FileMint.`}
        />
      </Screen>
    );
  }

  if (isText) {
    return (
      <Screen
        padded
        edges={['top']}
        footer={
          <Button
            title={busy ? 'Saving...' : 'Save'}
            icon="content-save-outline"
            onPress={saveText}
            loading={busy}
            full
          />
        }
      >
        <AppHeader title={`Edit - ${file.name}`} showBack />
        <View style={{ flex: 1, paddingBottom: Spacing.md }}>
          <TextInput
            value={text ?? ''}
            onChangeText={setText}
            multiline
            placeholder="Edit text..."
            placeholderTextColor={theme.textMuted}
            style={{
              flex: 1,
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: Radius.md,
              padding: Spacing.lg,
              fontFamily: Fonts.mono,
              fontSize: 14,
              textAlignVertical: 'top',
            }}
          />
        </View>
      </Screen>
    );
  }

  // Office editing runs through Collabora on the web app.
  if (Platform.OS !== 'web') {
    return (
      <Screen padded>
        <AppHeader title={file.name} showBack />
        <EmptyState
          icon="monitor"
          title="Edit on the web app"
          subtitle="Editing Word/Excel/PowerPoint runs in the FileMint web app."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <View style={{ paddingHorizontal: Spacing.lg }}>
        <AppHeader
          title={`Edit - ${file.name}`}
          showBack
          onBack={closeAndBack}
          right={
            <Button
              title={busy ? 'Saving...' : 'Save & Close'}
              size="sm"
              icon="content-save-outline"
              onPress={saveOffice}
              loading={busy}
              disabled={!editorLaunch?.url || Boolean(error)}
            />
          }
        />
        {saveError ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.sm,
              borderWidth: 1,
              borderColor: theme.danger,
              backgroundColor: theme.dangerMuted,
              borderRadius: Radius.md,
              padding: Spacing.md,
              marginBottom: Spacing.sm,
            }}
          >
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Txt variant="caption" style={{ color: theme.text, flex: 1 }}>
              {saveError}
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {error ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: Spacing.xl }}>
            <EmptyState
              icon="alert-circle-outline"
              title="Editor unavailable"
              subtitle={`${error} Start Collabora in Docker to edit inside FileMint, or use the file actions below.`}
              compact
            />
            <View style={{ gap: Spacing.sm, maxWidth: 520, alignSelf: 'center', width: '100%' }}>
              <Button title="Check again" icon="refresh" onPress={retryEditor} full />
              <Button
                title="Preview file"
                icon="eye-outline"
                variant="secondary"
                onPress={() => router.replace(`/viewer/${file.id}`)}
                full
              />
              <Button
                title="Download for Word"
                icon="download-outline"
                variant="secondary"
                onPress={() => void downloadFile(file)}
                full
              />
              <Button
                title="Share"
                icon="share-variant"
                variant="secondary"
                onPress={() => void shareFile(file)}
                disabled={!shareSupported}
                full
              />
            </View>
          </View>
        ) : editorLaunch?.url && editorLaunch.frameAllowed ? (
          <CollaboraEditor ref={editorRef} url={editorLaunch.url} />
        ) : editorLaunch?.url ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: Spacing.xl }}>
            <EmptyState
              icon="open-in-new"
              title="Open Office editor"
              subtitle="The hosted Collabora service is online, but it does not allow this web app to embed it. Open it in a new tab, save there, then return and press Save & Close."
              compact
            />
            <View style={{ gap: Spacing.sm, maxWidth: 560, alignSelf: 'center', width: '100%' }}>
              <Button title="Open Office editor" icon="open-in-new" onPress={openHostedEditor} full />
              <Button title="Check again" icon="refresh" variant="secondary" onPress={retryEditor} full />
              <Button
                title="Download for Word"
                icon="download-outline"
                variant="secondary"
                onPress={() => void downloadFile(file)}
                full
              />
              <Button
                title="Share"
                icon="share-variant"
                variant="secondary"
                onPress={() => void shareFile(file)}
                disabled={!shareSupported}
                full
              />
              {editorLaunch.framePolicy ? (
                <Txt variant="tiny" muted center>
                  Collabora frame policy must include{' '}
                  {typeof window !== 'undefined' ? window.location.origin : 'this app origin'}.
                </Txt>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.primary} size="large" />
            <Txt variant="caption" muted style={{ marginTop: Spacing.md }}>
              Opening editor...
            </Txt>
          </View>
        )}
      </View>
    </Screen>
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
