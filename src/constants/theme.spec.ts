import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: {
    select: (options: Record<string, unknown>) => options.web ?? options.default,
  },
}));

let theme: typeof import('./theme');

describe('design tokens', () => {
  beforeAll(async () => {
    theme = await import('./theme');
  });

  it('keeps light and dark palettes structurally interchangeable', () => {
    const { Colors } = theme;
    expect(Object.keys(Colors.light).sort()).toEqual(Object.keys(Colors.dark).sort());
    expect(Colors.dark.primary).toMatch(/^#[0-9A-F]{6}$/i);
    expect(Colors.light.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('publishes complete spacing, typography, radius, and accent scales', () => {
    const { Accents, DesktopContentWidth, FontSize, MaxContentWidth, Radius, Spacing, TAB_BAR_HEIGHT } =
      theme;
    expect(Spacing).toMatchObject({ none: 0, md: 12, huge: 40 });
    expect(FontSize).toMatchObject({ xs: 11, md: 15, display: 32 });
    expect(Radius).toMatchObject({ xs: 6, xl: 24, pill: 999 });
    expect(Object.keys(Accents)).toHaveLength(18);
    expect({ TAB_BAR_HEIGHT, MaxContentWidth, DesktopContentWidth }).toEqual({
      TAB_BAR_HEIGHT: 64,
      MaxContentWidth: 880,
      DesktopContentWidth: 1240,
    });
  });

  it('selects web fonts and computes each elevation level', () => {
    const { elevation, Fonts } = theme;
    expect(Fonts.sans).toBe('var(--font-display)');
    expect(elevation()).toMatchObject({ shadowOpacity: 0.18, shadowRadius: 8 });
    expect(elevation(2)).toMatchObject({ shadowOpacity: 0.24, shadowRadius: 16 });
    expect(elevation(3)).toMatchObject({ shadowOpacity: 0.32, shadowRadius: 28 });
  });
});
