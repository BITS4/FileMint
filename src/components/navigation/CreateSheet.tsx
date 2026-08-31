import { useRouter } from 'expo-router';

import { ActionSheet, type SheetAction } from '@/components/ui';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';

export interface CreateSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function CreateSheet({ visible, onClose }: CreateSheetProps) {
  const router = useRouter();

  const handleImport = async () => {
    const picked = await pickDocuments({ multiple: true, type: '*/*' });
    if (picked.length === 0) return;
    for (const file of picked) {
      await importIntoLibrary(file);
    }
    router.push('/files');
  };

  const actions: SheetAction[] = [
    { label: 'Scan with camera', icon: 'line-scan', onPress: () => router.push('/scan') },
    {
      label: 'Images to PDF',
      icon: 'image-multiple',
      onPress: () => router.push('/convert-to-pdf?profile=image'),
    },
    { label: 'Import a file', icon: 'file-import-outline', onPress: handleImport },
    {
      label: 'Text note to PDF',
      icon: 'note-plus-outline',
      onPress: () => router.push('/convert-to-pdf?profile=text'),
    },
  ];

  return <ActionSheet visible={visible} onClose={onClose} title="Create or import" actions={actions} />;
}
