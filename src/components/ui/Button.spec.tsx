// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

const mocks = vi.hoisted(() => ({ tap: vi.fn() }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    backgroundElement: '#222222',
    border: '#333333',
    danger: '#cc0000',
    primary: '#00cc99',
    primaryText: '#001111',
    text: '#ffffff',
  }),
}));
vi.mock('@/lib/haptics', () => ({ tap: mocks.tap }));
vi.mock('./Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-testid="icon">{name}</span> }));

afterEach(() => {
  cleanup();
  mocks.tap.mockClear();
});

describe('Button', () => {
  it('runs haptics before the supplied action', () => {
    const onPress = vi.fn();
    render(<Button title="Convert" onPress={onPress} icon="file-pdf" />);

    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    expect(mocks.tap).toHaveBeenCalledOnce();
    expect(onPress).toHaveBeenCalledOnce();
    expect(screen.getByTestId('icon').textContent).toBe('file-pdf');
  });

  it('blocks actions and displays progress while loading', () => {
    const onPress = vi.fn();
    render(<Button title="Save" onPress={onPress} loading />);

    fireEvent.click(screen.getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
    expect(mocks.tap).not.toHaveBeenCalled();
    expect(screen.queryByText('Save')).toBeNull();
  });
});
