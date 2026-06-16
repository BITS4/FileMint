import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  AppHeader,
  Card,
  EmptyState,
  FileRow,
  Screen,
  SectionHeader,
  TextField,
  ToolRow,
} from '@/components/ui';
import { searchTools } from '@/constants/tools';
import { Spacing } from '@/constants/theme';
import { useOpenTool } from '@/hooks/use-open-tool';
import { goBack } from '@/lib/nav';
import { useShallow } from 'zustand/react/shallow';

import { selectActiveFiles, useLibrary } from '@/store/useLibrary';
import type { ToolDef } from '@/types';

export default function SearchScreen() {
  const router = useRouter();
  const openTool = useOpenTool();
  const [query, setQuery] = useState('');
  const files = useLibrary(useShallow(selectActiveFiles));

  const toolResults = useMemo(() => searchTools(query), [query]);
  const fileResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return files.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 12);
  }, [files, query]);

  const open = (tool: ToolDef) => openTool(tool);
  const hasQuery = query.trim().length > 0;
  const empty = hasQuery && toolResults.length === 0 && fileResults.length === 0;

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Search" showBack onBack={goBack} />
      <TextField
        icon="magnify"
        placeholder="Search tools and files…"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="none"
        returnKeyType="search"
      />

      {!hasQuery ? (
        <EmptyState
          icon="magnify"
          title="Find anything"
          subtitle="Search across every tool and all of your files."
          compact
        />
      ) : empty ? (
        <EmptyState icon="file-search-outline" title="No results" subtitle={`Nothing matches “${query.trim()}”.`} compact />
      ) : (
        <View>
          {fileResults.length > 0 ? (
            <>
              <SectionHeader title="Files" />
              {fileResults.map((file) => (
                <FileRow key={file.id} file={file} onPress={() => router.push(`/viewer/${file.id}`)} />
              ))}
            </>
          ) : null}
          {toolResults.length > 0 ? (
            <>
              <SectionHeader title="Tools" />
              <Card padded={false} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
                {toolResults.map((tool) => (
                  <ToolRow key={tool.id} tool={tool} onPress={() => open(tool)} />
                ))}
              </Card>
            </>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
