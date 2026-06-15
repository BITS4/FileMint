import { useRouter } from 'expo-router';

import { ToolGroup } from '@/components/tools/ToolGroup';
import { AppHeader, IconButton, Screen, Txt } from '@/components/ui';
import { CATEGORIES, toolsByCategory } from '@/constants/tools';
import { Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import type { ToolDef } from '@/types';

export default function ToolsScreen() {
  const router = useRouter();
  const desktop = useIsDesktop();
  const open = (tool: ToolDef) => router.push(tool.route);

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: desktop ? 42 : 110 }}>
      <AppHeader
        title={desktop ? 'Tool catalogue' : 'All Tools'}
        right={<IconButton name="magnify" onPress={() => router.push('/search')} accessibilityLabel="Search tools" />}
      />
      <Txt variant="caption" muted style={{ marginTop: -6, marginBottom: Spacing.sm }}>
        Every FileMint tool, grouped by what it does.
      </Txt>
      {CATEGORIES.map((category) => (
        <ToolGroup key={category.key} title={category.label} tools={toolsByCategory(category.key)} onOpen={open} />
      ))}
    </Screen>
  );
}
