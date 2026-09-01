import { Pressable, ScrollView, View } from 'react-native';

import { styles } from '@/components/pdf-editor/styles';
import { ActionButton, ActionWrap, Labeled } from '@/components/pdf-editor/controls';
import { ToolSpecificPanel } from '@/components/pdf-editor/ToolSpecificPanel';
import { Button, Icon, Segmented, TextField, Txt } from '@/components/ui';
import { Accents } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { APPLY_OPTIONS, CROP_MODE_OPTIONS, EDITOR_TOOLS, TOOL_IDS } from '@/lib/pdf-editor/constants';
import type { ApplyScope } from '@/lib/pdf-editor/geometry';
import type { CropMode, EditorOptions, EditorToolId, ToolMeta } from '@/lib/pdf-editor/types';
import type { FileItem } from '@/types';

export function ToolSettings({
  tool,
  activeTool,
  setActiveTool,
  cropMode,
  setCropMode,
  applyScope,
  setApplyScope,
  pageRange,
  setPageRange,
  editorOptions,
  setEditorOptions,
  beforeAfter,
  setBeforeAfter,
  onAuto,
  onRemoveMargins,
  onPerfect,
  onReset,
  onApply,
  onAddObject,
  saving,
  canApply,
  resultFile,
  onPreview,
  onDownload,
  onShare,
  shareSupported,
  resultAction,
}: {
  tool: ToolMeta;
  activeTool: EditorToolId;
  setActiveTool: (tool: EditorToolId) => void;
  cropMode: CropMode;
  setCropMode: (mode: CropMode) => void;
  applyScope: ApplyScope;
  setApplyScope: (scope: ApplyScope) => void;
  pageRange: string;
  setPageRange: (value: string) => void;
  editorOptions: EditorOptions;
  setEditorOptions: (updater: (prev: EditorOptions) => EditorOptions) => void;
  beforeAfter: 'before' | 'after';
  setBeforeAfter: (value: 'before' | 'after') => void;
  onAuto: () => void;
  onRemoveMargins: () => void;
  onPerfect: () => void;
  onReset: () => void;
  onApply: () => void;
  onAddObject: (optionOverrides?: Partial<EditorOptions>) => void;
  saving: boolean;
  canApply: boolean;
  resultFile: FileItem | null;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  resultAction: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const accent = Accents[tool.accent];
  return (
    <View
      style={[
        desktop ? styles.settingsPanel : styles.mobileSheet,
        { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.settingsContent,
          !desktop && resultFile ? styles.settingsContentWithResultDock : null,
        ]}
      >
        <View style={styles.panelHeader}>
          <View style={[styles.toolPill, { backgroundColor: withAlpha(accent, 0.16) }]}>
            <Icon name={tool.icon} size={20} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{tool.title}</Txt>
            <Txt variant="tiny" muted>
              {tool.subtitle}
            </Txt>
          </View>
        </View>

        <Labeled label="Tool">
          <View
            style={[styles.toolScrollFrame, { borderColor: theme.border, backgroundColor: theme.background }]}
          >
            <ScrollView
              horizontal
              nestedScrollEnabled
              persistentScrollbar
              showsHorizontalScrollIndicator
              keyboardShouldPersistTaps="handled"
              style={styles.toolScroll}
              contentContainerStyle={styles.toolRail}
            >
              {TOOL_IDS.map((id) => {
                const meta = EDITOR_TOOLS[id];
                const active = id === activeTool;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setActiveTool(id)}
                    style={[
                      styles.toolChip,
                      {
                        backgroundColor: active
                          ? withAlpha(Accents[meta.accent], 0.22)
                          : theme.backgroundElement,
                        borderColor: active ? Accents[meta.accent] : theme.border,
                      },
                    ]}
                  >
                    <Icon
                      name={meta.icon}
                      size={16}
                      color={active ? Accents[meta.accent] : theme.textSecondary}
                    />
                    <Txt
                      variant="tiny"
                      style={{ color: active ? Accents[meta.accent] : theme.textSecondary }}
                    >
                      {meta.title}
                    </Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View pointerEvents="none" style={[styles.toolScrollCue, { backgroundColor: theme.background }]}>
              <Icon name="chevron-right" size={18} color={theme.textMuted} />
            </View>
          </View>
        </Labeled>

        {activeTool === 'crop-pdf' ? (
          <>
            <Labeled label="Crop mode">
              <Segmented options={CROP_MODE_OPTIONS} value={cropMode} onChange={setCropMode} />
            </Labeled>
            <ActionWrap>
              <ActionButton icon="auto-fix" label="Auto Detect" onPress={onAuto} accent={accent} />
              <ActionButton
                icon="page-layout-body"
                label="Remove Margins"
                onPress={onRemoveMargins}
                accent={accent}
              />
              <ActionButton
                icon="vector-square"
                label="Make Perfect Rectangle"
                onPress={onPerfect}
                accent={accent}
              />
              <ActionButton icon="rotate-right" label="Rotate" accent={accent} />
              <ActionButton icon="backup-restore" label="Reset" onPress={onReset} />
            </ActionWrap>
            <Labeled label="Compare">
              <Segmented
                options={[
                  { label: 'Before', value: 'before' },
                  { label: 'After', value: 'after' },
                ]}
                value={beforeAfter}
                onChange={setBeforeAfter}
              />
            </Labeled>
            <Labeled label="Apply to">
              <Segmented options={APPLY_OPTIONS} value={applyScope} onChange={setApplyScope} />
            </Labeled>
            {applyScope === 'range' ? (
              <TextField
                label="Page range"
                value={pageRange}
                onChangeText={setPageRange}
                placeholder="1-3, 7"
              />
            ) : null}
            <Button
              title="Apply Crop"
              icon="check"
              onPress={onApply}
              loading={saving}
              disabled={!canApply}
              full
            />
            <ResultActions
              file={resultFile}
              onPreview={onPreview}
              onDownload={onDownload}
              onShare={onShare}
              shareSupported={shareSupported}
              loading={resultAction}
            />
          </>
        ) : (
          <>
            <ToolSpecificPanel
              tool={activeTool}
              accent={accent}
              options={editorOptions}
              setOptions={setEditorOptions}
              onApply={onApply}
              onAddObject={onAddObject}
              saving={saving}
              canApply={canApply}
            />
            <ResultActions
              file={resultFile}
              onPreview={onPreview}
              onDownload={onDownload}
              onShare={onShare}
              shareSupported={shareSupported}
              loading={resultAction}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ResultActions({
  file,
  onPreview,
  onDownload,
  onShare,
  shareSupported,
  loading,
}: {
  file: FileItem | null;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  loading: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  if (!file) return null;
  return (
    <View
      style={[
        styles.resultPanel,
        { backgroundColor: theme.primaryMuted, borderColor: withAlpha(theme.primary, 0.48) },
      ]}
    >
      <View style={styles.resultHeader}>
        <View style={[styles.resultIcon, { backgroundColor: theme.primary }]}>
          <Icon name="check" size={16} color={theme.primaryText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="label" numberOfLines={1}>
            Result ready
          </Txt>
          <Txt variant="tiny" muted numberOfLines={1}>
            {file.name}
          </Txt>
        </View>
      </View>
      <View style={styles.resultActions}>
        <Button
          title="Preview"
          icon="eye-outline"
          variant="secondary"
          onPress={onPreview}
          disabled={Boolean(loading)}
          full
        />
        <Button
          title="Download"
          icon="download-outline"
          variant="secondary"
          onPress={onDownload}
          loading={loading === 'download'}
          disabled={loading === 'share'}
          full
        />
        <Button
          title="Share"
          icon="share-variant"
          variant="secondary"
          onPress={onShare}
          loading={loading === 'share'}
          disabled={!shareSupported || loading === 'download'}
          full
        />
      </View>
    </View>
  );
}

export function MobileResultDock({
  file,
  onPreview,
  onDownload,
  onShare,
  shareSupported,
  loading,
}: {
  file: FileItem | null;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  loading: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  if (!file) return null;
  return (
    <View
      style={[
        styles.mobileResultDock,
        { backgroundColor: theme.backgroundElevated, borderColor: withAlpha(theme.primary, 0.55) },
      ]}
    >
      <View style={styles.mobileResultTitle}>
        <View style={[styles.resultIcon, { backgroundColor: theme.primary }]}>
          <Icon name="check" size={16} color={theme.primaryText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="label" numberOfLines={1}>
            Result ready
          </Txt>
          <Txt variant="tiny" muted numberOfLines={1}>
            {file.name}
          </Txt>
        </View>
      </View>
      <View style={styles.mobileResultButtons}>
        <Button
          title="Preview"
          icon="eye-outline"
          variant="secondary"
          size="sm"
          onPress={onPreview}
          disabled={Boolean(loading)}
          full
        />
        <Button
          title="Download"
          icon="download-outline"
          variant="secondary"
          size="sm"
          onPress={onDownload}
          loading={loading === 'download'}
          disabled={loading === 'share'}
          full
        />
        <Button
          title="Share"
          icon="share-variant"
          variant="secondary"
          size="sm"
          onPress={onShare}
          loading={loading === 'share'}
          disabled={!shareSupported || loading === 'download'}
          full
        />
      </View>
    </View>
  );
}
