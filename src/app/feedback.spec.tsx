// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FeedbackScreen from './feedback';

const mocks = vi.hoisted(() => ({
  authState: { token: 'session-token' as string | null },
  confirm: vi.fn(async () => undefined),
  goBack: vi.fn(),
  params: { type: undefined as string | undefined },
  submitFeedback: vi.fn(async () => ({ ok: true as const, id: 'feedback-1' })),
}));

vi.mock('expo-router', () => ({ useLocalSearchParams: () => mocks.params }));
vi.mock('@/lib/auth-api', () => ({ authApi: { submitFeedback: mocks.submitFeedback } }));
vi.mock('@/lib/confirm', () => ({ confirm: mocks.confirm }));
vi.mock('@/lib/nav', () => ({ goBack: mocks.goBack }));
vi.mock('@/store/useAuth', () => ({
  useAuth: (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
}));
vi.mock('@/components/ui', () => ({
  AppHeader: ({ title }: { title?: string }) => <h1>{title}</h1>,
  Button: ({
    disabled,
    loading,
    onPress,
    title,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onPress: () => void;
    title: string;
  }) => (
    <button disabled={disabled || loading} onClick={onPress}>
      {title}
    </button>
  ),
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
  TextField: ({
    label,
    onChangeText,
    value,
  }: {
    label: string;
    onChangeText: (value: string) => void;
    value: string;
  }) => <textarea aria-label={label} value={value} onChange={(event) => onChangeText(event.target.value)} />,
  Txt: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

beforeEach(() => {
  mocks.authState.token = 'session-token';
  mocks.params.type = undefined;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('FeedbackScreen', () => {
  it('requires authentication instead of pretending to store a message locally', async () => {
    mocks.authState.token = null;
    render(<FeedbackScreen />);
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'A useful report' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('Sign in required', expect.any(String)));
    expect(mocks.submitFeedback).not.toHaveBeenCalled();
    expect(mocks.goBack).not.toHaveBeenCalled();
  });

  it('submits trimmed feature requests and closes only after acknowledgement', async () => {
    mocks.params.type = 'feature';
    render(<FeedbackScreen />);
    fireEvent.change(screen.getByLabelText('Your idea'), { target: { value: '  Add batch signing  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() =>
      expect(mocks.submitFeedback).toHaveBeenCalledWith('session-token', {
        type: 'feature',
        message: 'Add batch signing',
      }),
    );
    expect(mocks.confirm).toHaveBeenCalledWith('Feature requested', expect.stringContaining('review inbox'));
    expect(mocks.goBack).toHaveBeenCalledOnce();
  });

  it('keeps the screen open and exposes real delivery failures', async () => {
    mocks.submitFeedback.mockRejectedValueOnce(new Error('Server unavailable'));
    render(<FeedbackScreen />);
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Found a problem' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith('Could not send', 'Server unavailable'));
    expect(mocks.goBack).not.toHaveBeenCalled();
  });
});
