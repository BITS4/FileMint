// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Chip } from './Chip';
import { FilterChips } from './FilterChips';
import { Segmented } from './Segmented';

const mocks = vi.hoisted(() => ({ tap: vi.fn() }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    backgroundElement: '#202020',
    border: '#303030',
    primary: '#22cc88',
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

describe('selection controls', () => {
  it('activates a chip action with tactile feedback', () => {
    const onPress = vi.fn();
    render(<Chip label="Favorites" active icon="star" onPress={onPress} />);

    fireEvent.click(screen.getByText('Favorites'));

    expect(screen.getByText('star')).not.toBeNull();
    expect(mocks.tap).toHaveBeenCalledOnce();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('maps filter labels back to their stable keys', () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        items={[
          { key: 'all', label: 'All' },
          { key: 'pdf', label: 'PDF files' },
        ]}
        value="all"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('PDF files'));
    expect(onChange).toHaveBeenCalledWith('pdf');
  });

  it('reports the selected segmented value and optional icon', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { label: 'Simple', value: 'simple' },
          { label: 'OCR', value: 'ocr', icon: 'text-recognition' },
        ]}
        value="simple"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('OCR'));
    expect(screen.getByText('text-recognition')).not.toBeNull();
    expect(onChange).toHaveBeenCalledWith('ocr');
  });
});
