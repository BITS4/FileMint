import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';

import { EmptyState } from '@/components/ui';

export interface CollaboraEditorHandle {
  save: () => Promise<CollaboraSaveResult>;
}

export interface CollaboraEditorProps {
  url: string;
}

export interface CollaboraSaveResult {
  confirmed: boolean;
  hadEdits: boolean;
}

// Native placeholder: the Collabora iframe editor runs on web only.
export const CollaboraEditor = forwardRef<CollaboraEditorHandle, CollaboraEditorProps>((_props, ref) => {
  useImperativeHandle(ref, () => ({ save: async () => ({ confirmed: false, hadEdits: false }) }));
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <EmptyState
        icon="monitor"
        title="Edit on the web app"
        subtitle="Editing Word, Excel and PowerPoint runs in the FileMint web app."
      />
    </View>
  );
});

CollaboraEditor.displayName = 'CollaboraEditor';
