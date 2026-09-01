// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';

const mocks = vi.hoisted(() => ({ tap: vi.fn() }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    backgroundElement: '#202020',
    border: '#303030',
    danger: '#cc0000',
    primary: '#22cc88',
    primaryMuted: '#22cc8822',
    primaryText: '#001100',
    text: '#ffffff',
    textSecondary: '#aaaaaa',
  }),
}));
vi.mock('@/lib/haptics', () => ({ tap: mocks.tap }));
vi.mock('./Icon', () => ({ Icon: ({ name }: { name: string }) => <span>{name}</span> }));

afterEach(() => {
  cleanup();
  mocks.tap.mockClear();
});

describe('empty and icon actions', () => {
  it('offers a recovery action when both label and handler exist', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon="file-search"
        title="No documents"
        subtitle="Import a file to begin."
        actionLabel="Import file"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import file' }));
    expect(screen.getByText('No documents')).not.toBeNull();
    expect(screen.getByText('Import a file to begin.')).not.toBeNull();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('prevents a disabled icon button from firing', () => {
    const onPress = vi.fn();
    const view = render(
      <IconButton name="delete" accessibilityLabel="Delete file" disabled onPress={onPress} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(mocks.tap).not.toHaveBeenCalled();

    view.rerender(<IconButton name="delete" accessibilityLabel="Delete file" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(onPress).toHaveBeenCalledOnce();
    expect(mocks.tap).toHaveBeenCalledOnce();
  });
});
