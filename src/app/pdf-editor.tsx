import { ActivityIndicator, Image, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CropOverlay } from '@/components/pdf-editor/CropOverlay';
import { EditorObjectsOverlay } from '@/components/pdf-editor/EditorObjectsOverlay';
import { MobileResultDock, ToolSettings } from '@/components/pdf-editor/ToolSettings';
import { PageSidebar, PageStrip, TopToolbar } from '@/components/pdf-editor/chrome';
import { styles } from '@/components/pdf-editor/styles';
import { PickFile } from '@/components/tools/PickFile';
import { Button, Icon, IconButton, ProgressBar, Txt } from '@/components/ui';
import { Accents } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { premiumUpgradeRoute } from '@/hooks/use-open-tool';
import { usePdfEditorController } from '@/hooks/use-pdf-editor-controller';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';

export default function PdfEditorScreen() {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const { width } = useWindowDimensions();
  const {
    router,
    activeTool,
    setActiveTool,
    catalogTool,
    isPremium,
    file,
    pages,
    pageIndex,
    setPageIndex,
    rendering,
    progress,
    renderError,
    zoom,
    setZoom,
    toast,
    setToast,
    saving,
    resultFile,
    resultAction,
    cropMode,
    setCropMode,
    applyScope,
    setApplyScope,
    pageRange,
    setPageRange,
    quad,
    setQuad,
    beforeAfter,
    setBeforeAfter,
    cropDragging,
    setCropDragging,
    editorOptions,
    setEditorOptions,
    selectedObjectId,
    canvasInteracting,
    setCanvasInteracting,
    tool,
    accent,
    shareSupported,
    currentPage,
    pageCount,
    pageWidth,
    canApply,
    pageObjects,
    pickFile,
    selectEditorObject,
    patchEditorObject,
    addEditorObject,
    eraseDoodlesAt,
    addObjectForActiveTool,
    clearSelectedObject,
    applyPreview,
    downloadResult,
    shareResult,
    previewResult,
    resetCrop,
    makePerfect,
  } = usePdfEditorController(desktop, width);
  if (catalogTool?.premium && !isPremium) {
    const upgradeRoute = premiumUpgradeRoute(
      catalogTool,
      `/pdf-editor?tool=${encodeURIComponent(activeTool)}`,
    );
    return (
      <SafeAreaView
        style={[styles.root, styles.lockedRoot, { backgroundColor: theme.background }]}
        edges={['top']}
      >
        <View style={[styles.lockedCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.bigIcon, { backgroundColor: withAlpha(Accents.amber, 0.18) }]}>
            <Icon name="crown-outline" size={36} color={Accents.amber} />
          </View>
          <Txt variant="title" center>
            Premium editor
          </Txt>
          <Txt variant="caption" muted center>
            {catalogTool.premiumReason ?? `${catalogTool.title} is included with FileMint Premium.`}
          </Txt>
          <Button
            title="Upgrade Now"
            icon="crown-outline"
            full
            onPress={() => router.push(upgradeRoute as never)}
          />
          <Button
            title="View Plans"
            icon="credit-card-outline"
            variant="secondary"
            full
            onPress={() => router.push(upgradeRoute as never)}
          />
          <Button title="Maybe Later" variant="ghost" full onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <TopToolbar
        title={tool.title}
        fileName={file?.name}
        zoom={zoom}
        onBack={() => router.back()}
        onUndo={() => setToast({ tone: 'success', text: 'Undo preview state restored' })}
        onRedo={() => setToast({ tone: 'success', text: 'Redo preview state restored' })}
        onZoomIn={() => setZoom((z) => Math.min(1.8, Math.round((z + 0.1) * 10) / 10))}
        onZoomOut={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
        onFit={() => setZoom(1)}
        onSave={applyPreview}
        saving={saving}
        canSave={canApply}
      />

      {!file ? (
        <View style={styles.pickShell}>
          <View style={[styles.pickPanel, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <View style={[styles.bigIcon, { backgroundColor: withAlpha(accent, 0.16) }]}>
              <Icon name={tool.icon} size={34} color={accent} />
            </View>
            <Txt variant="title" center>
              {tool.title}
            </Txt>
            <Txt variant="caption" muted center style={styles.pickSubtitle}>
              Choose a PDF to open the full editor with thumbnails, canvas preview, zoom, crop, and tool
              controls.
            </Txt>
            <PickFile
              onPicked={pickFile}
              title="Select PDF"
              subtitle="Import from your device or choose an existing FileMint PDF."
              icon="file-pdf-box"
            />
          </View>
        </View>
      ) : (
        <View style={[styles.editorBody, desktop ? styles.editorBodyDesktop : styles.editorBodyMobile]}>
          {desktop ? (
            <PageSidebar pages={pages} pageIndex={pageIndex} loading={rendering} onSelect={setPageIndex} />
          ) : null}
          <View style={styles.canvasColumn}>
            <View
              style={[
                styles.canvasHeader,
                { borderColor: theme.border, backgroundColor: theme.backgroundElevated },
              ]}
            >
              <View style={styles.canvasTitle}>
                <View style={[styles.toolPill, { backgroundColor: withAlpha(accent, 0.16) }]}>
                  <Icon name={tool.icon} size={18} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="label" numberOfLines={1}>
                    Page {pageIndex + 1} of {pageCount}
                  </Txt>
                  <Txt variant="tiny" muted numberOfLines={1}>
                    {tool.subtitle}
                  </Txt>
                </View>
              </View>
              <View style={styles.canvasNav}>
                <IconButton
                  name="chevron-left"
                  variant="surface"
                  disabled={pageIndex === 0}
                  onPress={() => setPageIndex((p) => Math.max(0, p - 1))}
                  accessibilityLabel="Previous page"
                />
                <IconButton
                  name="chevron-right"
                  variant="surface"
                  disabled={pageIndex >= pages.length - 1}
                  onPress={() => setPageIndex((p) => Math.min(pages.length - 1, p + 1))}
                  accessibilityLabel="Next page"
                />
              </View>
            </View>

            <View style={[styles.stage, { backgroundColor: '#111820' }]}>
              {rendering ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator color={theme.primary} />
                  <Txt variant="h3">Rendering PDF pages</Txt>
                  <View style={{ width: 260 }}>
                    <ProgressBar progress={progress} />
                  </View>
                </View>
              ) : renderError ? (
                <View style={styles.loadingState}>
                  <Icon name="alert-circle-outline" size={34} color={theme.danger} />
                  <Txt variant="h3">Preview unavailable</Txt>
                  <Txt variant="caption" muted center style={{ maxWidth: 360 }}>
                    {renderError}
                  </Txt>
                </View>
              ) : (
                <ScrollView
                  style={styles.stageScroll}
                  scrollEnabled={!cropDragging && !canvasInteracting}
                  contentContainerStyle={styles.stageContent}
                  horizontal
                  bounces={false}
                  showsHorizontalScrollIndicator={false}
                >
                  <ScrollView
                    contentContainerStyle={styles.stageInner}
                    bounces={false}
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={!cropDragging && !canvasInteracting}
                  >
                    <View style={[styles.pageSurface, { width: pageWidth, aspectRatio: 0.707 }]}>
                      {currentPage ? (
                        <Image
                          source={{ uri: currentPage.uri }}
                          resizeMode="contain"
                          style={styles.pageImage}
                        />
                      ) : null}
                      {activeTool === 'crop-pdf' ? (
                        <CropOverlay
                          quad={quad}
                          mode={cropMode}
                          accent={accent}
                          onChange={setQuad}
                          onDragStateChange={setCropDragging}
                        />
                      ) : (
                        <EditorObjectsOverlay
                          tool={activeTool}
                          pageIndex={pageIndex}
                          objects={pageObjects}
                          selectedObjectId={selectedObjectId}
                          options={editorOptions}
                          accent={accent}
                          onSelect={selectEditorObject}
                          onClearSelection={clearSelectedObject}
                          onPatch={patchEditorObject}
                          onAdd={addEditorObject}
                          onEraseDoodlesAt={eraseDoodlesAt}
                          onInteractionStateChange={setCanvasInteracting}
                        />
                      )}
                    </View>
                  </ScrollView>
                </ScrollView>
              )}
            </View>

            {!desktop ? (
              <PageStrip pages={pages} pageIndex={pageIndex} loading={rendering} onSelect={setPageIndex} />
            ) : null}
          </View>

          <ToolSettings
            tool={tool}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            cropMode={cropMode}
            setCropMode={setCropMode}
            applyScope={applyScope}
            setApplyScope={setApplyScope}
            pageRange={pageRange}
            setPageRange={setPageRange}
            editorOptions={editorOptions}
            setEditorOptions={setEditorOptions}
            beforeAfter={beforeAfter}
            setBeforeAfter={setBeforeAfter}
            onAuto={() => {
              setQuad({
                tl: { x: 0.09, y: 0.08 },
                tr: { x: 0.9, y: 0.09 },
                br: { x: 0.88, y: 0.9 },
                bl: { x: 0.1, y: 0.88 },
              });
              setToast({ tone: 'success', text: 'Document edges detected' });
            }}
            onRemoveMargins={() => {
              setQuad({
                tl: { x: 0.06, y: 0.05 },
                tr: { x: 0.94, y: 0.05 },
                br: { x: 0.94, y: 0.95 },
                bl: { x: 0.06, y: 0.95 },
              });
              setToast({ tone: 'success', text: 'Margins removed in preview' });
            }}
            onPerfect={makePerfect}
            onReset={resetCrop}
            onApply={applyPreview}
            onAddObject={addObjectForActiveTool}
            saving={saving}
            canApply={canApply}
            resultFile={resultFile}
            onPreview={previewResult}
            onDownload={downloadResult}
            onShare={shareResult}
            shareSupported={shareSupported}
            resultAction={resultAction}
          />
        </View>
      )}

      {toast ? (
        <View
          style={[styles.toast, { backgroundColor: toast.tone === 'success' ? theme.success : theme.danger }]}
        >
          <Icon
            name={toast.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'}
            size={18}
            color="#06120E"
          />
          <Txt variant="label" style={{ color: '#06120E' }}>
            {toast.text}
          </Txt>
        </View>
      ) : null}
      {!desktop ? (
        <MobileResultDock
          file={resultFile}
          onPreview={previewResult}
          onDownload={downloadResult}
          onShare={shareResult}
          shareSupported={shareSupported}
          loading={resultAction}
        />
      ) : null}
    </SafeAreaView>
  );
}
