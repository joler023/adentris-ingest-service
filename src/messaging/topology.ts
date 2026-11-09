import { crc32 } from 'node:zlib';
import type { ConfirmChannel } from 'amqplib';

export const EVENTS_EXCHANGE = 'events';
export const DEAD_LETTER = 'events.dead';
export const RETRIES_HEADER = 'x-retries';

export interface TopologyOptions {
  partitions: number;
  retryDelaysMs: number[];
}

/** Same patient -> same partition -> same queue. Stable across processes and restarts. */
export function partitionOf(patientId: string, partitions: number): number {
  return crc32(patientId) % partitions;
}

export const partitionQueue = (partition: number) => `events.p${partition}`;
export const retryName = (step: number) => `events.retry.${step}`;

/**
 * Declared by every process on every (re)connect, so the API can never publish
 * into a missing queue (an unroutable message would be confirmed and dropped).
 *
 *  events (direct) --events.pN--> events.pN        one single-active-consumer queue per partition
 *  events.retry.S (fanout) -----> events.retry.S   TTL queue, dead-letters back to `events`
 *                                                  keeping the original routing key (= events.pN)
 *  events.dead (fanout) --------> events.dead      events that exhausted their attempts
 */
export async function assertTopology(
  channel: ConfirmChannel,
  options: TopologyOptions,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, 'direct', { durable: true });

  for (let partition = 0; partition < options.partitions; partition++) {
    const queue = partitionQueue(partition);
    await channel.assertQueue(queue, {
      durable: true,
      arguments: { 'x-single-active-consumer': true },
    });
    await channel.bindQueue(queue, EVENTS_EXCHANGE, queue);
  }

  for (const [step, delay] of options.retryDelaysMs.entries()) {
    const name = retryName(step);
    await channel.assertExchange(name, 'fanout', { durable: true });
    await channel.assertQueue(name, {
      durable: true,
      arguments: {
        'x-message-ttl': delay,
        'x-dead-letter-exchange': EVENTS_EXCHANGE,
      },
    });
    await channel.bindQueue(name, name, '');
  }

  await channel.assertExchange(DEAD_LETTER, 'fanout', { durable: true });
  await channel.assertQueue(DEAD_LETTER, { durable: true });
  await channel.bindQueue(DEAD_LETTER, DEAD_LETTER, '');
}
