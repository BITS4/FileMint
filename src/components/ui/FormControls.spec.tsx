// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PromptModal } from './PromptModal';
import { TextField } from './TextField';

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    backgroundElevated: '#101010',
    backgroundElement: '#202020',
    border: '#303030',
    danger: '#cc0000',
    overlay: '#000000aa',
    primary: '#22cc88',
    primaryText: '#001100',
    text: '#ffffff',
    textMuted: '#888888',
    textSecondary: '#aaaaaa',
  }),
}));
vi.mock('@/lib/haptics', () => ({ tap: vi.fn() }));
vi.mock('./Icon', () => ({ Icon: ({ name }: { name: string }) => <span>{name}</span> }));

afterEach(cleanup);

describe('TextField', () => {
  it('renders guidance and forwards edited text', () => {
    const onChangeText = vi.fn();
    render(
      <TextField
        label="File name"
        hint="Use a descriptive name"
        icon="file"
        value="Draft"
        onChangeText={onChangeText}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Draft'), { target: { value: 'Final' } });

    expect(screen.getByText('File name')).not.toBeNull();
    expect(screen.getByText('Use a descriptive name')).not.toBeNull();
    expect(screen.getByText('file')).not.toBeNull();
    expect(onChangeText).toHaveBeenCalledWith('Final');
  });
});

describe('PromptModal', () => {
  it('resets to the latest initial value and submits the edit', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <PromptModal visible title="Rename" initialValue="Draft" onSubmit={onSubmit} onClose={onClose} />,
    );

    fireEvent.change(screen.getByDisplayValue('Draft'), { target: { value: 'Final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('Final');

    view.rerender(
      <PromptModal visible title="Rename" initialValue="Published" onSubmit={onSubmit} onClose={onClose} />,
    );
    expect(screen.getByDisplayValue('Published')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
