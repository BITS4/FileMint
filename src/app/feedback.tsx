import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Button, Screen, TextField, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { authApi } from '@/lib/auth-api';
import { confirm } from '@/lib/confirm';
import { goBack } from '@/lib/nav';
import { useAuth } from '@/store/useAuth';

export default function FeedbackScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const isFeature = type === 'feature';
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const token = useAuth((state) => state.token);

  const submit = async () => {
    if (!text.trim()) return;
    if (!token) {
      await confirm('Sign in required', 'Sign in before sending feedback so we can follow up safely.');
      return;
    }
    setSending(true);
    try {
      await authApi.submitFeedback(token, {
        type: isFeature ? 'feature' : 'feedback',
        message: text.trim(),
      });
      await confirm(
        isFeature ? 'Feature requested' : 'Feedback sent',
        'Thanks! Your message is in the FileMint review inbox.',
      );
      goBack();
    } catch (error) {
      await confirm('Could not send', error instanceof Error ? error.message : 'Try again in a moment.');
    } finally {
      setSending(false);
    }
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
        <Button
          title={isFeature ? 'Submit request' : 'Send feedback'}
          icon="send-outline"
          onPress={submit}
          loading={sending}
          disabled={!text.trim()}
          full
        />
      </View>
    </Screen>
  );
}
