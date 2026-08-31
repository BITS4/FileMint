import { describe, expect, it } from 'vitest';
import { withAlpha } from './color';

describe('withAlpha', () => {
  it('converts short and long hex colors', () => {
    expect(withAlpha('#0af', 0.5)).toBe('rgba(0, 170, 255, 0.5)');
    expect(withAlpha('#123456', 1)).toBe('rgba(18, 52, 86, 1)');
  });

  it('preserves invalid colors', () => {
    expect(withAlpha('#not-a-color', 0.2)).toBe('#not-a-color');
  });
});
