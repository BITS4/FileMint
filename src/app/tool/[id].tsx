import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  AppHeader,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  Screen,
  Segmented,
  TextField,
  Txt,
} from '@/components/ui';
import { STATUS_LABEL, findTool } from '@/constants/tools';
import { Accents } from '@/constants/theme';
import { Spacing } from '@/constants/theme';
import { premiumUpgradeRoute } from '@/hooks/use-open-tool';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { type ServerStatus, checkServer } from '@/lib/api';
import { withAlpha } from '@/lib/color';
import { goBack } from '@/lib/nav';
import { type FieldValues, type ToolField, type ToolOperation, getOperation } from '@/lib/operations';
import { selectIsPremium, useAuth } from '@/store/useAuth';
import type { FileItem } from '@/types';

function seedValues(op: ToolOperation | null): FieldValues {
  const values: FieldValues = {};
  for (const f of op?.fields ?? []) values[f.key] = f.default ?? (f.type === 'switch' ? false : '');
  return values;
}

export default function ToolScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const runner = useRunner();
  const tool = findTool(id);
  const op = id ? getOperation(id) : null;
  const isPremium = useAuth(selectIsPremium);

  const [file, setFile] = useState<FileItem | null>(null);
  const [values, setValues] = useState<FieldValues>(() => seedValues(op));
  const [server, setServer] = useState<ServerStatus | null>(null);
  const needsServer = !!op?.serverCapability;

  const runCheck = () => {
    setServer(null);
    checkServer().then(setServer);
  };
  useEffect(() => {
    if (needsServer) runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsServer, id]);

  if (!tool) {
    return (
      <Screen padded>
        <AppHeader showBack />
        <EmptyState icon="help-circle-outline" title="Tool not found" subtitle="This tool doesn’t exist yet." />
      </Screen>
    );
  }

  if (tool.premium && !isPremium) {
    return <LockedToolScreen tool={tool} />;
  }

  if (!op || tool.status === 'soon') {
    return (
      <Screen padded>
        <AppHeader title={tool.title} showBack />
        <EmptyState
          icon="progress-wrench"
          title="Coming soon"
          subtitle={`${tool.title} is on the roadmap and not available in this build yet.`}
        />
      </Screen>
    );
  }

  if (op.mode === 'open') {
    return (
      <Screen scroll padded>
        <AppHeader title={tool.title} showBack />
        <PickFile
          onPicked={(f) => router.replace(`/viewer/${f.id}`)}
          kinds={op.libraryKinds}
          deviceTypes={op.deviceTypes}
          title={op.pickTitle ?? tool.title}
          icon={op.pickIcon ?? tool.icon}
        />
      </Screen>
    );
  }

  const setValue = (k: string, v: string | boolean) => setValues((prev) => ({ ...prev, [k]: v }));
  const capability = op.serverCapability;
  const serverMissing = needsServer && server !== null && (!server.online || (capability ? !server.capabilities[capability] : false));
  const run = () => {
    if (serverMissing || (needsServer && server === null)) return;
    runner.run((onProgress) => op.run!({ file, values, onProgress }));
  };
  const showEditor = runner.state !== 'done' && runner.state !== 'running';
  const needFile = op.mode === 'process';

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title={tool.title} showBack />
      {tool.subtitle ? (
        <Txt variant="caption" muted style={{ marginTop: -6, marginBottom: Spacing.md }}>
          {tool.subtitle}
        </Txt>
      ) : null}

      {needsServer && server === null ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <ActivityIndicator color={theme.primary} />
          <Txt variant="caption" muted>
            Checking conversion server…
          </Txt>
        </Card>
      ) : null}

      {serverMissing ? (
        <Card style={{ borderColor: theme.warning, gap: Spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon name="server-network-off" size={20} color={theme.warning} />
            <Txt variant="h3">Server needed</Txt>
          </View>
          <Txt variant="caption" muted>
            {server?.online
              ? `The server is online but the ${capability} engine isn’t installed. See the server README to enable it.`
              : `This tool processes files on the FileMint conversion server, which looks offline. Start it, then set its address in Settings.`}
          </Txt>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <Button title="Open Settings" variant="secondary" icon="cog-outline" onPress={() => router.push('/settings')} style={{ flex: 1 }} />
            <Button title="Check again" icon="refresh" onPress={runCheck} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {showEditor ? (
        needFile && !file ? (
          <PickFile
            onPicked={setFile}
            kinds={op.libraryKinds}
            deviceTypes={op.deviceTypes}
            title={op.pickTitle ?? `Select a file`}
            subtitle={op.pickSubtitle}
            icon={op.pickIcon ?? tool.icon}
          />
        ) : (
          <View style={{ gap: Spacing.md }}>
            {file ? (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <Icon name="file-check-outline" size={20} color={theme.primary} />
                <Txt variant="body" weight="600" numberOfLines={1} style={{ flex: 1 }}>
                  {file.name}
                </Txt>
                <Txt variant="caption" style={{ color: theme.primary }} onPress={() => setFile(null)}>
                  Change
                </Txt>
              </Card>
            ) : null}

            {(op.fields ?? []).map((field) => (
              <FieldControl key={field.key} field={field} value={values[field.key]} onChange={(v) => setValue(field.key, v)} />
            ))}

            <Button
              title={tool.title}
              icon={tool.icon}
              onPress={run}
              loading={runner.state === 'running'}
              disabled={!!serverMissing || (needsServer && server === null)}
              full
              size="lg"
              style={{ marginTop: Spacing.xs }}
            />
            {tool.status === 'beta' ? (
              <Txt variant="tiny" muted center>
                {STATUS_LABEL.beta} feature — results may vary.
              </Txt>
            ) : null}
          </View>
        )
      ) : null}

      <ToolOutcome runner={runner} runningLabel={`${tool.title}…`} doneLabel="All done" />
    </Screen>
  );
}

function LockedToolScreen({ tool }: { tool: NonNullable<ReturnType<typeof findTool>> }) {
  const router = useRouter();
  const theme = useTheme();
  const upgradeRoute = premiumUpgradeRoute(tool);

  return (
    <Screen padded>
      <AppHeader title={tool.title} showBack />
      <Card style={{ alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl }}>
        <View style={{ width: 78, height: 78, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(Accents.amber, 0.18) }}>
          <Icon name="crown-outline" size={38} color={Accents.amber} />
        </View>
        <Txt variant="title" center>
          Premium tool
        </Txt>
        <Txt variant="caption" muted center>
          {tool.premiumReason ?? `${tool.title} is included with FileMint Premium.`}
        </Txt>
        <Button title="Upgrade Now" icon="crown-outline" full onPress={() => router.push(upgradeRoute as never)} />
        <Button title="View Plans" variant="secondary" icon="credit-card-outline" full onPress={() => router.push(upgradeRoute as never)} />
        <Button title="Maybe Later" variant="ghost" full onPress={goBack} />
        <Txt variant="tiny" muted center style={{ color: theme.textSecondary }}>
          After upgrading, FileMint returns you to this tool automatically.
        </Txt>
      </Card>
    </Screen>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ToolField;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  const theme = useTheme();

  if (field.type === 'switch') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
        <Txt variant="body" weight="600">
          {field.label}
        </Txt>
        <Switch
          value={value === true || value === 'true'}
          onValueChange={onChange}
          trackColor={{ false: theme.backgroundSelected, true: withAlpha(theme.primary, 0.6) }}
          thumbColor={value === true ? theme.primary : '#f4f4f5'}
        />
      </View>
    );
  }

  if (field.type === 'select' && field.options) {
    if (field.options.length > 4) {
      return (
        <View style={{ gap: Spacing.xs }}>
          <Txt variant="label" muted style={{ marginLeft: 2 }}>
            {field.label}
          </Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm, paddingRight: Spacing.lg }}>
            {field.options.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                active={String(value) === opt.value}
                onPress={() => onChange(opt.value)}
              />
            ))}
          </ScrollView>
          {field.hint ? (
            <Txt variant="tiny" muted style={{ marginLeft: 2 }}>
              {field.hint}
            </Txt>
          ) : null}
        </View>
      );
    }

    return (
      <View style={{ gap: Spacing.xs }}>
        <Txt variant="label" muted style={{ marginLeft: 2 }}>
          {field.label}
        </Txt>
        <Segmented options={field.options} value={String(value)} onChange={onChange} />
      </View>
    );
  }

  return (
    <TextField
      label={field.label}
      value={String(value ?? '')}
      onChangeText={onChange}
      placeholder={field.placeholder}
      hint={field.hint}
      multiline={field.type === 'multiline'}
      secureTextEntry={field.type === 'password'}
      keyboardType={field.type === 'number' ? 'numbers-and-punctuation' : 'default'}
      autoCapitalize={field.type === 'password' ? 'none' : 'sentences'}
    />
  );
}
