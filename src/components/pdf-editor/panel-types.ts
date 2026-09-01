import type { EditorOptions, EditorToolId } from '@/lib/pdf-editor/types';

export interface ToolPanelProps {
  tool: EditorToolId;
  accent: string;
  options: EditorOptions;
  setOptions: (updater: (previous: EditorOptions) => EditorOptions) => void;
  onApply: () => void;
  onAddObject: (optionOverrides?: Partial<EditorOptions>) => void;
  saving: boolean;
  canApply: boolean;
}
