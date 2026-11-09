import type { CreateEventDto } from './create-event.schema.js';
import { eventKeyOf } from './event-key.js';

const event: CreateEventDto = {
  patientId: 'p1',
  type: 'heart-rate',
  data: { bpm: 70, meta: { a: 1, b: [1, 2] } },
  ts: '2026-01-01T00:00:00Z',
};

describe('eventKeyOf', () => {
  it('is stable for the same event', () => {
    expect(eventKeyOf(event)).toBe(eventKeyOf({ ...event }));
    expect(eventKeyOf(event)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores object key order, at any depth', () => {
    const reordered = {
      ...event,
      data: { meta: { b: [1, 2], a: 1 }, bpm: 70 },
    };
    expect(eventKeyOf(reordered)).toBe(eventKeyOf(event));
  });

  it('ignores how the timestamp is written', () => {
    expect(eventKeyOf({ ...event, ts: '2026-01-01T01:00:00.000+01:00' })).toBe(
      eventKeyOf(event),
    );
  });

  it.each([
    ['patient', { patientId: 'p2' }],
    ['type', { type: 'spo2' }],
    ['timestamp', { ts: '2026-01-01T00:00:01Z' }],
    ['data', { data: { bpm: 71, meta: { a: 1, b: [1, 2] } } }],
    ['array order', { data: { bpm: 70, meta: { a: 1, b: [2, 1] } } }],
  ])('changes when the %s changes', (_name, change) => {
    expect(eventKeyOf({ ...event, ...change })).not.toBe(eventKeyOf(event));
  });
});
