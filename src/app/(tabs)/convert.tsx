import { ToolGroup } from '@/components/tools/ToolGroup';
import { AppHeader, Screen, Txt } from '@/components/ui';
import { pickTools } from '@/constants/tools';
import { Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useOpenTool } from '@/hooks/use-open-tool';
import type { ToolDef } from '@/types';

const TO_PDF = pickTools([
  'image-to-pdf',
  'txt-to-pdf',
  'csv-to-pdf',
  'docx-to-pdf',
  'pptx-to-pdf',
  'xlsx-to-pdf',
]);
const FROM_PDF = pickTools([
  'pdf-to-jpg',
  'pdf-to-png',
  'pdf-to-docx',
  'pdf-to-xlsx',
  'pdf-to-pptx',
  'pdf-to-text',
  'pdf-to-html',
  'pdf-to-searchable',
]);
const BATCH = pickTools(['batch-convert']);

export default function ConvertScreen() {
  const desktop = useIsDesktop();
  const openTool = useOpenTool();
  const open = (tool: ToolDef) => openTool(tool);

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: desktop ? 42 : 110 }}>
      <AppHeader title={desktop ? 'Convert files' : 'Convert'} />
      <Txt variant="caption" muted style={{ marginTop: -6, marginBottom: Spacing.sm }}>
        Turn anything into a PDF — or a PDF into anything.
      </Txt>
      <ToolGroup title="To PDF" tools={TO_PDF} onOpen={open} />
      <ToolGroup title="From PDF" tools={FROM_PDF} onOpen={open} />
      <ToolGroup title="Bulk" tools={BATCH} onOpen={open} />
    </Screen>
  );
}
