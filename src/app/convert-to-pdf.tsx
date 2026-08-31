import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, View, type ImageStyle } from 'react-native';

import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  CropOverlay,
  HeroPick,
  PageFilmstrip,
  PageTile,
  webFilterStyle,
} from '@/components/convert-to-pdf/StudioParts';
import { StudioDashboard } from '@/components/convert-to-pdf/StudioDashboard';
import { AppHeader, Button, Card, Chip, Icon, IconButton, ProgressBar, Screen, Txt } from '@/components/ui';
import { Accents, Spacing } from '@/constants/theme';
import { useConvertToPdfStudio } from '@/hooks/use-convert-to-pdf-studio';
import { premiumUpgradeRoute } from '@/hooks/use-open-tool';
import { withAlpha } from '@/lib/color';
import { styles } from './convert-to-pdf.styles';

import { pageAspectRatio, profileTitle } from '@/lib/convert-to-pdf/model';
export default function ConvertToPdfScreen() {
  const router = useRouter();
  const studio = useConvertToPdfStudio();
  const {
    profile,
    theme,
    desktop,
    runner,
    isPremium,
    profileTool,
    files,
    pages,
    setPages,
    selectedPage,
    selectedIndex,
    includedCount,
    preparing,
    prepareError,
    prepareProgress,
    fullscreen,
    setFullscreen,
    pickFiles,
    rebuildPreview,
    updatePage,
    selectPage,
    goToAdjacentPage,
    updatePageQuad,
    movePage,
    rotateCurrent,
  } = studio;

  if (profileTool?.premium && !isPremium) {
    const redirect = `/convert-to-pdf?profile=${encodeURIComponent(profile)}`;
    const upgradeRoute = premiumUpgradeRoute(profileTool, redirect);
    return (
      <Screen padded contentContainerStyle={styles.lockedScreen}>
        <AppHeader title={profileTool.title} showBack />
        <Card style={styles.lockedCard}>
          <View style={[styles.lockedIcon, { backgroundColor: withAlpha(Accents.amber, 0.18) }]}>
            <Icon name="crown-outline" size={38} color={Accents.amber} />
          </View>
          <Txt variant="title" center>
            Premium conversion
          </Txt>
          <Txt variant="caption" muted center>
            {profileTool.premiumReason ?? `${profileTool.title} is included with FileMint Premium.`}
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
        </Card>
      </Screen>
    );
  }

  const dashboardContent = <StudioDashboard studio={studio} />;

  const selectedPreviewStyle =
    selectedPage?.filter === 'original' ? undefined : webFilterStyle(selectedPage?.filter ?? 'original');
  const renderPreviewCanvas = (large = false) =>
    selectedPage ? (
      <View style={[styles.previewWrap, large && styles.previewWrapFullscreen]}>
        <View
          style={[
            styles.previewStage,
            large && styles.previewStageFullscreen,
            {
              aspectRatio: pageAspectRatio(selectedPage),
              transform: [{ rotate: `${selectedPage.rotation}deg` }],
            },
            !selectedPage.included && { opacity: 0.36 },
          ]}
        >
          <Image
            source={{ uri: selectedPage.previewUri }}
            resizeMode="stretch"
            style={[styles.previewImage as ImageStyle, selectedPreviewStyle]}
          />
          <CropOverlay page={selectedPage} onChange={(quad) => updatePageQuad(selectedPage.id, quad)} />
        </View>
        {!selectedPage.included ? (
          <View style={styles.excludedBadge}>
            <Icon name="eye-off-outline" size={16} color="#FFFFFF" />
            <Txt variant="label" style={{ color: '#FFFFFF' }}>
              Excluded
            </Txt>
          </View>
        ) : null}
        <IconButton
          name="chevron-left"
          size={30}
          onPress={() => goToAdjacentPage(-1)}
          disabled={selectedIndex <= 0}
          accessibilityLabel="Previous page"
          style={StyleSheet.flatten([styles.pageArrow, styles.pageArrowLeft])}
        />
        <IconButton
          name="chevron-right"
          size={30}
          onPress={() => goToAdjacentPage(1)}
          disabled={selectedIndex >= pages.length - 1}
          accessibilityLabel="Next page"
          style={StyleSheet.flatten([styles.pageArrow, styles.pageArrowRight])}
        />
      </View>
    ) : null;

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 42 }}>
      <AppHeader
        title={profileTitle(profile)}
        subtitle="Preview, crop, filter, reorder, then export"
        showBack
        right={
          files.length ? (
            <Button
              title="Add files"
              icon="plus"
              size="sm"
              variant="secondary"
              onPress={pickFiles}
              disabled={preparing || runner.state === 'running'}
            />
          ) : null
        }
      />

      {!files.length && !preparing ? (
        <HeroPick profile={profile} onPick={pickFiles} error={prepareError} />
      ) : null}

      {preparing ? (
        <Card style={styles.preparingCard}>
          <View style={styles.row}>
            <ActivityIndicator color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="h3">Generating editable preview</Txt>
              <Txt variant="caption" muted>
                Office files are rendered with LibreOffice; images, CSV, and text are paginated into PDF
                pages.
              </Txt>
            </View>
          </View>
          <ProgressBar progress={prepareProgress} indeterminate={prepareProgress <= 0} />
        </Card>
      ) : null}

      {prepareError && files.length ? (
        <Card style={{ borderColor: theme.danger, gap: Spacing.sm }}>
          <View style={styles.row}>
            <Icon name="alert-circle-outline" size={22} color={theme.danger} />
            <Txt variant="h3" style={{ color: theme.danger }}>
              Preview failed
            </Txt>
          </View>
          <Txt variant="caption" muted>
            {prepareError}
          </Txt>
          <Button title="Try again" icon="refresh" variant="secondary" onPress={rebuildPreview} full />
        </Card>
      ) : null}

      {pages.length ? (
        <View style={[styles.studio, desktop && styles.studioDesktop]}>
          <View style={[styles.leftRail, desktop && styles.leftRailDesktop]}>
            <Card style={styles.summaryCard}>
              <View style={styles.rowBetween}>
                <View>
                  <Txt variant="h3">Pages</Txt>
                  <Txt variant="caption" muted>
                    {includedCount} of {pages.length} included
                  </Txt>
                </View>
                <Chip label={files.length > 1 ? 'Batch' : 'Single'} active />
              </View>
              <View style={styles.actionsRow}>
                <Button
                  title="All"
                  size="sm"
                  variant="secondary"
                  onPress={() => setPages((prev) => prev.map((page) => ({ ...page, included: true })))}
                  style={styles.actionButton}
                />
                <Button
                  title="None"
                  size="sm"
                  variant="ghost"
                  onPress={() => setPages((prev) => prev.map((page) => ({ ...page, included: false })))}
                  style={styles.actionButton}
                />
              </View>
            </Card>

            <View style={styles.pageList}>
              {pages.map((page, index) => (
                <PageTile
                  key={page.id}
                  page={page}
                  index={index}
                  active={page.id === selectedPage?.id}
                  onPress={() => selectPage(page)}
                  onToggle={() => updatePage(page.id, { included: !page.included })}
                  onUp={() => movePage(page.id, -1)}
                  onDown={() => movePage(page.id, 1)}
                  canUp={index > 0}
                  canDown={index < pages.length - 1}
                />
              ))}
            </View>
          </View>

          <View style={styles.previewPane}>
            <Card padded={false} style={styles.previewCard}>
              <View
                style={[
                  styles.previewToolbar,
                  { backgroundColor: withAlpha(theme.background, 0.86), borderColor: theme.border },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="label" numberOfLines={1}>
                    Page {selectedIndex + 1} of {pages.length}
                  </Txt>
                  <Txt variant="tiny" muted numberOfLines={1}>
                    {selectedPage?.fileName ?? 'No page selected'}
                  </Txt>
                </View>
                <IconButton
                  name="chevron-left"
                  size={22}
                  onPress={() => goToAdjacentPage(-1)}
                  disabled={selectedIndex <= 0}
                  accessibilityLabel="Previous page"
                />
                <IconButton
                  name="chevron-right"
                  size={22}
                  onPress={() => goToAdjacentPage(1)}
                  disabled={selectedIndex >= pages.length - 1}
                  accessibilityLabel="Next page"
                />
                <IconButton
                  name="fullscreen"
                  size={22}
                  onPress={() => setFullscreen(true)}
                  accessibilityLabel="Open fullscreen editor"
                />
              </View>
              {renderPreviewCanvas(false)}
            </Card>
            {selectedPage ? (
              <Card style={styles.selectedMeta}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="label" numberOfLines={1}>
                    {selectedPage.fileName}
                  </Txt>
                  <Txt variant="tiny" muted>
                    Page {selectedPage.sourceIndex + 1} - {selectedPage.fileKind.toUpperCase()}
                  </Txt>
                </View>
                <IconButton
                  name="rotate-right"
                  size={22}
                  onPress={rotateCurrent}
                  accessibilityLabel="Rotate page"
                />
                <IconButton
                  name={selectedPage.included ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                  size={24}
                  color={selectedPage.included ? theme.primary : theme.textSecondary}
                  onPress={() => updatePage(selectedPage.id, { included: !selectedPage.included })}
                  accessibilityLabel="Include page"
                />
              </Card>
            ) : null}
            <PageFilmstrip pages={pages} selectedId={selectedPage?.id} onSelect={selectPage} />
          </View>

          <View style={[styles.rightRail, desktop && styles.rightRailDesktop]}>{dashboardContent}</View>
        </View>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Creating final PDF..." doneLabel="PDF ready" />
      <Modal
        visible={fullscreen && !!selectedPage}
        animationType="fade"
        onRequestClose={() => setFullscreen(false)}
      >
        <View style={[styles.fullscreenShell, { backgroundColor: theme.background }]}>
          <View style={[styles.fullscreenHeader, { borderColor: theme.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="h3" numberOfLines={1}>
                Fullscreen page editor
              </Txt>
              <Txt variant="caption" muted numberOfLines={1}>
                Page {selectedIndex + 1} of {pages.length} - crop, filter, and export from the dashboard
              </Txt>
            </View>
            <IconButton
              name="chevron-left"
              size={24}
              onPress={() => goToAdjacentPage(-1)}
              disabled={selectedIndex <= 0}
              accessibilityLabel="Previous page"
            />
            <IconButton
              name="chevron-right"
              size={24}
              onPress={() => goToAdjacentPage(1)}
              disabled={selectedIndex >= pages.length - 1}
              accessibilityLabel="Next page"
            />
            <IconButton
              name="fullscreen-exit"
              size={24}
              onPress={() => setFullscreen(false)}
              accessibilityLabel="Close fullscreen editor"
            />
          </View>
          <View style={styles.fullscreenBody}>
            <View style={styles.fullscreenPreviewPane}>
              <View style={[styles.fullscreenPreviewCard, { backgroundColor: '#6F747B' }]}>
                {renderPreviewCanvas(true)}
              </View>
              <PageFilmstrip pages={pages} selectedId={selectedPage?.id} onSelect={selectPage} />
            </View>
            <ScrollView
              style={[styles.fullscreenDashboard, { borderColor: theme.border }]}
              contentContainerStyle={styles.fullscreenDashboardContent}
              showsVerticalScrollIndicator
            >
              {dashboardContent}
              <ToolOutcome runner={runner} runningLabel="Creating final PDF..." doneLabel="PDF ready" />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
