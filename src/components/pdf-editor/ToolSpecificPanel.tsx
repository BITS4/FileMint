import { AnnotationFormToolPanel } from '@/components/pdf-editor/AnnotationFormToolPanel';
import { BasicToolPanel } from '@/components/pdf-editor/BasicToolPanel';
import { DrawToolPanel } from '@/components/pdf-editor/DrawToolPanel';
import type { ToolPanelProps } from '@/components/pdf-editor/panel-types';
import { SignatureToolPanel } from '@/components/pdf-editor/SignatureToolPanel';
import { StampToolPanel } from '@/components/pdf-editor/StampToolPanel';

export function ToolSpecificPanel(props: ToolPanelProps) {
  const { tool } = props;
  if (tool === 'add-page-numbers' || tool === 'add-watermark' || tool === 'flatten' || tool === 'add-text') {
    return <BasicToolPanel {...props} />;
  }
  if (tool === 'add-signature') return <SignatureToolPanel {...props} />;
  if (tool === 'doodle' || tool === 'highlight') return <DrawToolPanel {...props} />;
  if (tool === 'add-stamp') return <StampToolPanel {...props} />;
  return <AnnotationFormToolPanel {...props} />;
}
