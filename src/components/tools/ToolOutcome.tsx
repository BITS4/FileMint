import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { Button, Card, Icon, ProgressBar, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { goBack } from '@/lib/nav';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import type { Runner } from '@/hooks/use-runner';
import type { ConversionReport, FileItem } from '@/types';

export interface ToolOutcomeProps {
  runner: Runner;
  runningLabel?: string;
  doneLabel?: string;
}

export function ToolOutcome({ runner, runningLabel = 'Working...', doneLabel = 'Done!' }: ToolOutcomeProps) {
  const theme = useTheme();
  const router = useRouter();
  const shareSupported = canShareFiles();
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (runner.state !== 'running') return;
    pulse.setValue(0);
    spin.setValue(0);
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    pulseLoop.start();
    spinLoop.start();
    return () => {
      pulseLoop.stop();
      spinLoop.stop();
    };
  }, [pulse, runner.state, spin]);

  useEffect(() => {
    if (runner.state !== 'done' && runner.state !== 'error') {
      appear.setValue(0);
      return;
    }
    Animated.spring(appear, {
      toValue: 1,
      speed: 18,
      bounciness: 7,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [appear, runner.state]);

  if (runner.state === 'running') {
    const iconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
    const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.28] });
    const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <Card style={[styles.card, styles.runningCard, { borderColor: withAlpha(theme.primary, 0.42) }]}>
        <View style={styles.runningGlowArea} pointerEvents="none">
          <Animated.View
            style={[
              styles.runningGlow,
              {
                backgroundColor: withAlpha(theme.primary, 0.18),
                transform: [{ scale: glowScale }],
              },
            ]}
          />
          <View style={[styles.runningGlowAlt, { backgroundColor: withAlpha(theme.info, 0.12) }]} />
        </View>
        <View style={styles.headerRow}>
          <Animated.View
            style={[
              styles.runningBadge,
              { backgroundColor: theme.primaryMuted, transform: [{ scale: iconScale }, { rotate }] },
            ]}>
            <Icon name="file-sync-outline" size={24} color={theme.primary} />
          </Animated.View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="body" weight="700" numberOfLines={1}>
              {runningLabel}
            </Txt>
            <Txt variant="tiny" muted numberOfLines={1}>
              Preparing a clean editable result
            </Txt>
          </View>
        </View>
        <ProgressBar progress={runner.progress} indeterminate={runner.progress <= 0} />
        {runner.progress > 0 ? (
          <Txt variant="caption" muted>
            {Math.round(runner.progress * 100)}%
          </Txt>
        ) : null}
      </Card>
    );
  }

  if (runner.state === 'error') {
    return (
      <Animated.View style={{ opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
        <Card style={[styles.card, { borderColor: theme.danger }]}>
          <View style={styles.headerRow}>
            <Icon name="alert-circle-outline" size={22} color={theme.danger} />
            <Txt variant="h3" style={{ color: theme.danger }}>
              Failed
            </Txt>
          </View>
          <Txt variant="caption" muted>
            {runner.error}
          </Txt>
          <Button title="Try again" variant="secondary" icon="refresh" onPress={runner.reset} full />
        </Card>
      </Animated.View>
    );
  }

  if (runner.state === 'done' && runner.result) {
    const results = Array.isArray(runner.result) ? runner.result : [runner.result];
    const single = results.length === 1 ? results[0] : undefined;
    return (
      <Animated.View style={{ opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
        <Card style={[styles.card, styles.doneCard, { borderColor: withAlpha(theme.primary, 0.46) }]}>
          <View style={[styles.successIcon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
            <Icon name="check-circle" size={30} color={theme.primary} />
          </View>
          <Txt variant="h3" center>
            {doneLabel}
          </Txt>
          <Txt variant="caption" muted center>
            {single ? `Saved "${single.name}" to your files.` : `${results.length} files saved to your files.`}
          </Txt>
          {single?.conversionReport ? <ConversionReportView report={single.conversionReport} /> : null}
          <View style={styles.actions}>
            {single ? (
              <Button title={single.conversionReport ? 'Preview' : 'Open'} icon="eye-outline" onPress={() => router.replace(`/viewer/${single.id}`)} full />
            ) : (
              <Button title="View in Files" icon="folder-outline" onPress={() => router.replace('/files')} full />
            )}
            {single ? (
              <Button title="Download" icon="download-outline" variant="secondary" onPress={() => void downloadFile(single)} full />
            ) : null}
            {single ? (
              <Button title="Share" icon="share-variant" variant="secondary" onPress={() => void shareFile(single)} disabled={!shareSupported} full />
            ) : null}
            <Button title="Done" variant="ghost" onPress={goBack} full />
          </View>
        </Card>
      </Animated.View>
    );
  }

  return null;
}

function ConversionReportView({ report }: { report: ConversionReport }) {
  const theme = useTheme();
  const warnings = [...(report.warnings ?? []), ...(report.notes ?? [])].filter(Boolean).slice(0, 3);
  const rows = [
    ['Mode', report.resolvedMode ?? report.requestedMode ?? 'unknown'],
    ['PDF type', report.pdfType ?? 'unknown'],
    ['Editable text', report.editableTextDetected === undefined ? 'Unknown' : report.editableTextDetected ? 'Yes' : 'No'],
    ['Editable regions', String(report.editableTextBoxes ?? 0)],
    ['Editable chars', String(report.editableCharacters ?? 0)],
    ['DOCX editable chars', String(report.outputEditableCharacters ?? report.editableCharacters ?? 0)],
    ['Text coverage', report.textCoverageEstimate === undefined ? 'Unknown' : `${report.textCoverageEstimate}%`],
    ['Hidden text layer', report.hiddenTextLayer === undefined ? 'No' : report.hiddenTextLayer ? 'Yes' : 'No'],
    ['Word tables', String(report.tablesRebuiltAsWord ?? 0)],
    ['Tables', String(report.tablesDetected ?? 0)],
    ['DOCX tables', String(report.outputTables ?? 0)],
    ['Visual objects', String(report.visualFragmentsPreserved ?? report.visualObjectsPreserved ?? 0)],
    ['Pages', String(report.pagesConverted ?? '-')],
    ['OCR language', report.ocrLanguage || 'Not used'],
    ['OCR passes', report.ocrPasses?.length ? report.ocrPasses.join(', ') : 'Not used'],
    ['Low-confidence OCR', String(report.lowConfidenceOcrAreas ?? 0)],
  ];

  return (
    <View style={[styles.report, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.headerRow}>
        <Icon name="clipboard-check-outline" size={20} color={theme.primary} />
        <Txt variant="h3">Quality report</Txt>
      </View>
      <View style={styles.reportGrid}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.reportRow}>
            <Txt variant="tiny" muted style={styles.reportLabel}>
              {label}
            </Txt>
            <Txt variant="label" style={styles.reportValue} numberOfLines={1}>
              {value}
            </Txt>
          </View>
        ))}
      </View>
      {warnings.length ? (
        <View style={{ gap: 3 }}>
          {warnings.map((warning, i) => (
            <Txt key={`${warning}-${i}`} variant="tiny" muted>
              {warning}
            </Txt>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function resultFiles(result: Runner['result']): FileItem[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, marginTop: Spacing.lg, alignItems: 'stretch' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  runningCard: { overflow: 'hidden' },
  runningGlowArea: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  runningGlow: { position: 'absolute', width: 190, height: 190, borderRadius: 95, right: -72, top: -88 },
  runningGlowAlt: { position: 'absolute', width: 140, height: 140, borderRadius: 70, left: -54, bottom: -74 },
  runningBadge: { width: 48, height: 48, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  doneCard: { overflow: 'hidden' },
  successIcon: { width: 60, height: 60, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  report: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm },
  reportGrid: { gap: 6 },
  reportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  reportLabel: { flex: 1 },
  reportValue: { flex: 1, textAlign: 'right' },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
});
