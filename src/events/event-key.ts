import { createHash } from 'node:crypto';
import type { CreateEventDto } from './create-event.schema.js';

/**
 * The payload carries no provider event ID, so identity is a fingerprint of its
 * content: redeliveries of the same event hash identically, while two different
 * events with identical content would collide (see ARCHITECTURE.md).
 */
export function eventKeyOf(event: CreateEventDto): string {
  const identity = [
    event.patientId,
    event.type,
    new Date(event.ts).toISOString(),
    canonicalize(event.data),
  ];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

/** Sorts object keys recursively, so key order never changes the fingerprint. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}
