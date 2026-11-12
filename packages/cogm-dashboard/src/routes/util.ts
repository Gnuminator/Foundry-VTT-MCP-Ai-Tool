export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function readStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
