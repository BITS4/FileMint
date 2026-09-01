// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Badge } from './Badge';
import { Card } from './Card';

const mocks = vi.hoisted(() => ({ tap: vi.fn() }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ card: '#101010', border: '#303030', text: '#ffffff', textSecondary: '#aaaaaa' }),
}));
vi.mock('@/lib/haptics', () => ({ tap: mocks.tap }));

afterEach(() => {
  cleanup();
  mocks.tap.mockClear();
});

describe('Badge', () => {
  it.each(['solid', 'soft', 'outline'] as const)('renders the %s status variant', (variant) => {
    render(<Badge label={`${variant} status`} color="#22cc88" variant={variant} small />);
    expect(screen.getByText(`${variant} status`)).not.toBeNull();
  });
});

describe('Card', () => {
  it('renders static content without inventing an action', () => {
    render(<Card>Document details</Card>);
    fireEvent.click(screen.getByText('Document details'));
    expect(mocks.tap).not.toHaveBeenCalled();
  });

  it('runs haptics and its action when interactive', () => {
    const onPress = vi.fn();
    render(<Card onPress={onPress}>Open document</Card>);

    fireEvent.click(screen.getByText('Open document'));

    expect(mocks.tap).toHaveBeenCalledOnce();
    expect(onPress).toHaveBeenCalledOnce();
  });
});
