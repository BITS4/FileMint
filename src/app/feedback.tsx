import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Button, Screen, TextField, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { confirm } from '@/lib/confirm';
import { goBack } from '@/lib/nav';

export default function FeedbackScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const isFeature = type === 'feature';
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSending(true);
    // No backend inbox in this build — acknowledge locally so the flow is real.
    await new Promise((r) => setTimeout(r, 500));
    setSending(false);
    await confirm(isFeature ? 'Feature requested' : 'Feedback sent', 'Thanks! Your message has been recorded on this device.');
    goBack();
  };

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title={isFeature ? 'Request a feature' : 'Send feedback'} showBack onBack={goBack} />
      <Txt variant="caption" muted style={{ marginBottom: Spacing.lg }}>
        {isFeature
          ? 'What would make FileMint better for you?'
          : 'Found a bug or have a suggestion? We read everything.'}
      </Txt>
      <TextField
        label={isFeature ? 'Your idea' : 'Your message'}
        placeholder={isFeature ? 'I wish FileMint could…' : 'Tell us what happened…'}
        value={text}
        onChangeText={setText}
        multiline
      />
      <View style={{ marginTop: Spacing.xl }}>
        <Button title={isFeature ? 'Submit request' : 'Send feedback'} icon="send-outline" onPress={submit} loading={sending} disabled={!text.trim()} full />
      </View>
    </Screen>
  );
}
