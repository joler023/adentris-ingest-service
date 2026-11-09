import { z } from 'zod';
import { EventStatus } from '../events/event.schema.js';

/** Response shapes: written once, used for OpenAPI and by tests that keep the docs honest. */
export const acceptedSchema = z
  .object({
    eventKey: z
      .string()
      .describe(
        'Deterministic identity of the event; use it to query its state.',
      ),
  })
  .meta({
    id: 'Accepted',
    example: { eventKey: 'a3f1c0...64 hex characters' },
  });

export const eventStateSchema = z
  .object({
    eventKey: z.string(),
    patientId: z.string(),
    type: z.string(),
    data: z.record(z.string(), z.unknown()),
    ts: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    status: z
      .enum(EventStatus)
      .describe(
        'PENDING: retry scheduled. PROCESSING: claimed by a worker. COMPLETED / FAILED: terminal.',
      ),
    attempts: z.number().int().describe('Processing attempts started so far.'),
    lastError: z
      .string()
      .optional()
      .describe('Error of the last failed attempt.'),
    result: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Outcome of the processing, once COMPLETED.'),
    outOfOrder: z
      .boolean()
      .describe(
        'A newer event (by ts) of the same patient had already completed.',
      ),
    completedAt: z.iso.datetime().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'EventState' });

export const errorSchema = z
  .object({
    statusCode: z.number().int(),
    message: z.union([z.string(), z.array(z.string())]),
    error: z.string().optional(),
  })
  .meta({
    id: 'Error',
    example: {
      statusCode: 400,
      error: 'Bad Request',
      message: ['ts: Invalid ISO datetime'],
    },
  });

export const eventKeyParam = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'eventKey must be 64 hex characters');

/** `@ApiResponse` takes plain OpenAPI schemas; Zod 4 produces them. */
export const openApiSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output' }) as Record<
    string,
    unknown
  >;
