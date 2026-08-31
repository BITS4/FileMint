import { describe, expect, it } from 'vitest';

import { booleanValue, numberValue, stringValue } from './operations.values';

describe('operation field values', () => {
  it('parses finite numeric strings', () => {
    expect(numberValue({ opacity: '0.35' }, 'opacity', 1)).toBeCloseTo(0.35);
  });

  it('uses the numeric fallback for missing and invalid values', () => {
    expect(numberValue({}, 'pages', 2)).toBe(2);
    expect(numberValue({ pages: 'many' }, 'pages', 2)).toBe(2);
  });

  it('reads strings without coercing booleans', () => {
    expect(stringValue({ name: 'Report' }, 'name')).toBe('Report');
    expect(stringValue({ name: true }, 'name', 'Untitled')).toBe('Untitled');
  });

  it('accepts boolean and serialized true values', () => {
    expect(booleanValue({ enabled: true }, 'enabled')).toBe(true);
    expect(booleanValue({ enabled: 'true' }, 'enabled')).toBe(true);
  });

  it('rejects false-like and missing values', () => {
    expect(booleanValue({ enabled: false }, 'enabled')).toBe(false);
    expect(booleanValue({ enabled: 'false' }, 'enabled')).toBe(false);
    expect(booleanValue({}, 'enabled')).toBe(false);
  });
});
