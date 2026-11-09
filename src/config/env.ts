import { z } from 'zod';

const delayList = z
  .string()
  .transform((raw) => raw.split(',').map((ms) => Number(ms.trim())))
  .pipe(z.array(z.number().int().positive()).min(1));

export const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    WORKER_PORT: z.coerce.number().int().positive().default(3001),
    MONGODB_URI: z.string().default('mongodb://localhost:27017/ingest'),
    RABBITMQ_URL: z.string().default('amqp://localhost:5672'),
    PARTITIONS: z.coerce.number().int().positive().default(256),
    RETRY_DELAYS_MS: delayList.default([5_000, 30_000, 120_000]),
    EXTERNAL_PROCESSING_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(5_000),
    EXTERNAL_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    EXTERNAL_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    LEASE_MS: z.coerce.number().int().positive().default(30_000),
  })
  .refine((env) => env.LEASE_MS > env.EXTERNAL_TIMEOUT_MS, {
    message:
      'LEASE_MS must exceed EXTERNAL_TIMEOUT_MS, or a live attempt could be taken over',
    path: ['LEASE_MS'],
  });

export type Env = z.infer<typeof envSchema>;
