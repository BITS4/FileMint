export type FieldValues = Record<string, string | boolean>;

export function numberValue(values: FieldValues, key: string, fallback: number): number {
  const value = values[key];
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function stringValue(values: FieldValues, key: string, fallback = ''): string {
  return typeof values[key] === 'string' ? (values[key] as string) : fallback;
}

export function booleanValue(values: FieldValues, key: string): boolean {
  return values[key] === true || values[key] === 'true';
}
