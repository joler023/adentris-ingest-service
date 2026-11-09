import { z } from 'zod';

export const createEventSchema = z
  .object({
    patientId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe(
        'Patient the event belongs to. Events of one patient are processed one at a time.',
      ),
    type: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe('Kind of event, e.g. "heart-rate".'),
    data: z
      .record(z.string(), z.unknown())
      .describe('Free-form event payload.'),
    ts: z.iso
      .datetime({ offset: true })
      .describe('When the event was created at the source (ISO 8601).'),
  })
  .meta({
    id: 'CreateEvent',
    example: {
      patientId: 'patient-42',
      type: 'heart-rate',
      data: { bpm: 72 },
      ts: '2026-11-08T10:15:30.000Z',
    },
  });

export type CreateEventDto = z.infer<typeof createEventSchema>;
