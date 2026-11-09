import { z } from 'zod';

/** What travels through RabbitMQ: the accepted event plus its identity. */
export const eventMessageSchema = z.object({
  eventKey: z.string(),
  patientId: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  ts: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
});

export type EventMessage = z.infer<typeof eventMessageSchema>;
