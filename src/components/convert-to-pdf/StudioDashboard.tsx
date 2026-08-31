import { Pressable, ScrollView, View } from 'react-native';

import { Button, Card, Icon, Segmented, TextField, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { ConvertToPdfStudio } from '@/hooks/use-convert-to-pdf-studio';
import { withAlpha } from '@/lib/color';
import {
  EXPORT_OPTIONS,
  FILTERS,
  MARGIN_OPTIONS,
  ORIENTATION_OPTIONS,
  PAGE_SIZE_OPTIONS,
  QUALITY_OPTIONS,
} from '@/lib/convert-to-pdf/model';
import { styles } from '@/app/convert-to-pdf.styles';

import { Field } from './StudioParts';

export function StudioDashboard({ studio }: { studio: ConvertToPdfStudio }) {
  const {
    selectedPage,
    filterCount,
    theme,
    cropTop,
    setCropTop,
    cropRight,
    setCropRight,
    cropBottom,
    setCropBottom,
    cropLeft,
    setCropLeft,
    updateCurrentCrop,
    resetCrop,
    applyFilter,
    exportMode,
    setExportMode,
    pageSize,
    setPageSize,
    orientation,
    setOrientation,
    margin,
    setMargin,
    quality,
    setQuality,
    fileName,
    setFileName,
    files,
    csvDelimiter,
    setCsvDelimiter,
    textFontSize,
    setTextFontSize,
    rebuildPreview,
    preparing,
    exportPdf,
    runner,
    includedCount,
  } = studio;

  return (
    <>
      <Card style={styles.panel}>
        <Txt variant="h3">Crop</Txt>
        <Txt variant="caption" muted>
          Drag the page corners or enter exact edge percentages.
        </Txt>
        <View style={styles.cropGrid}>
          <TextField label="Top %" value={cropTop} onChangeText={setCropTop} keyboardType="numeric" />
          <TextField label="Right %" value={cropRight} onChangeText={setCropRight} keyboardType="numeric" />
          <TextField
            label="Bottom %"
            value={cropBottom}
            onChangeText={setCropBottom}
            keyboardType="numeric"
          />
          <TextField label="Left %" value={cropLeft} onChangeText={setCropLeft} keyboardType="numeric" />
        </View>
        <View style={styles.actionsRow}>
          <Button
            title="Current"
            size="sm"
            icon="crop"
            variant="secondary"
            onPress={() => updateCurrentCrop(false)}
            style={styles.actionButton}
          />
          <Button
            title="All"
            size="sm"
            icon="crop-free"
            onPress={() => updateCurrentCrop(true)}
            style={styles.actionButton}
          />
        </View>
        <View style={styles.actionsRow}>
          <Button
            title="A4 crop"
            size="sm"
            variant="secondary"
            onPress={() => {
              setCropTop('3');
              setCropRight('3');
              setCropBottom('3');
              setCropLeft('3');
              updateCurrentCrop(false);
            }}
            style={styles.actionButton}
          />
          <Button
            title="Reset"
            size="sm"
            variant="ghost"
            onPress={() => resetCrop(false)}
            style={styles.actionButton}
          />
        </View>
      </Card>

      <Card style={styles.panel}>
        <View style={styles.rowBetween}>
          <Txt variant="h3">Filters</Txt>
          <Txt variant="tiny" muted>
            {filterCount} applied
          </Txt>
        </View>
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={styles.filterScroller}
          contentContainerStyle={styles.filterGrid}
        >
          {FILTERS.map((filter) => {
            const active = selectedPage?.filter === filter.value;
            return (
              <Pressable
                key={filter.value}
                onPress={() => applyFilter(filter.value, false)}
                style={[
                  styles.filterChip,
                  {
                    borderColor: active ? theme.primary : theme.border,
                    backgroundColor: active ? withAlpha(theme.primary, 0.16) : theme.backgroundElement,
                  },
                ]}
              >
                <Icon name={filter.icon} size={17} color={active ? theme.primary : theme.textSecondary} />
                <Txt
                  variant="tiny"
                  weight="700"
                  numberOfLines={1}
                  style={{ color: active ? theme.primary : theme.text }}
                >
                  {filter.label}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.actionsRow}>
          <Button
            title="Apply all"
            size="sm"
            icon="image-filter-center-focus"
            onPress={() => selectedPage && applyFilter(selectedPage.filter, true)}
            style={styles.actionButton}
          />
          <Button
            title="Reset"
            size="sm"
            variant="ghost"
            icon="restore"
            onPress={() => applyFilter('original', true)}
            style={styles.actionButton}
          />
        </View>
        <Txt variant="tiny" muted>
          Filters create image-finished pages. Leave Original for the sharpest document PDF.
        </Txt>
      </Card>

      <Card style={styles.panel}>
        <Txt variant="h3">Output</Txt>
        <Field label="Export mode">
          <Segmented options={EXPORT_OPTIONS} value={exportMode} onChange={setExportMode} />
        </Field>
        <Field label="Page size">
          <Segmented options={PAGE_SIZE_OPTIONS} value={pageSize} onChange={setPageSize} />
        </Field>
        <Field label="Orientation">
          <Segmented options={ORIENTATION_OPTIONS} value={orientation} onChange={setOrientation} />
        </Field>
        <Field label="Margins">
          <Segmented options={MARGIN_OPTIONS} value={margin} onChange={setMargin} />
        </Field>
        <Field label="Quality">
          <Segmented options={QUALITY_OPTIONS} value={quality} onChange={setQuality} />
        </Field>
        <TextField
          label="File name"
          value={fileName}
          onChangeText={setFileName}
          placeholder="Converted document"
        />
        {files.some((file) => file.kind === 'csv' || file.kind === 'text') ? (
          <View style={{ gap: Spacing.sm }}>
            <TextField
              label="CSV delimiter"
              value={csvDelimiter}
              onChangeText={setCsvDelimiter}
              placeholder=","
            />
            <TextField
              label="Text font size"
              value={textFontSize}
              onChangeText={setTextFontSize}
              keyboardType="numeric"
            />
            <Button
              title="Update preview"
              icon="refresh"
              variant="secondary"
              onPress={rebuildPreview}
              disabled={preparing}
              full
            />
          </View>
        ) : null}
        <Button
          title="Convert to PDF"
          icon="file-pdf-box"
          size="lg"
          onPress={exportPdf}
          loading={runner.state === 'running'}
          disabled={!includedCount || preparing}
          full
        />
      </Card>
    </>
  );
}
