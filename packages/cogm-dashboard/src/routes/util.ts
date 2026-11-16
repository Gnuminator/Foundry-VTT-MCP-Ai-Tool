import { asRecord as asRecordOrNull } from '@gnuminator/shared';

/** The value as a plain object, or an empty one when it is anything else. */
export function asRecord(value: unknown): Record<string, unknown> {
  return asRecordOrNull(value) ?? {};
}

export function readStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
