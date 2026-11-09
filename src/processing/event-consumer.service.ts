import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import type { Env } from '../config/env.js';
import { EventMessage, eventMessageSchema } from '../events/event-message.js';
import { BrokerService } from '../messaging/broker.service.js';
import { partitionQueue, RETRIES_HEADER } from '../messaging/topology.js';
import { EventProcessor, Outcome } from './event-processor.service.js';

const SHUTDOWN_DRAIN_MS = 25_000;

/**
 * Consumes every partition queue with manual acks and one message in flight per
 * queue. RabbitMQ keeps a single active consumer per queue, so events of one
 * patient never overlap, across any number of worker processes.
 */
@Injectable()
export class EventConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(EventConsumer.name);
  private readonly inFlight = new Set<Promise<void>>();
  private readonly partitions: number;

  constructor(
    private readonly broker: BrokerService,
    private readonly processor: EventProcessor,
    config: ConfigService<Env, true>,
  ) {
    this.partitions = config.get('PARTITIONS', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.broker.ready();
    for (let partition = 0; partition < this.partitions; partition++) {
      await this.broker.channel.consume(
        partitionQueue(partition),
        (message) => this.track(message),
        { prefetch: 1 },
      );
    }
    this.logger.log(`Consuming ${this.partitions} partition queues`);
  }

  /** Stop taking new messages, let the running ones finish; anything left is redelivered after the lease. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.broker.channel.cancelAll();
    const drained = Promise.allSettled(this.inFlight);
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, SHUTDOWN_DRAIN_MS).unref(),
    );
    await Promise.race([drained, timeout]);
  }

  private track(message: ConsumeMessage): void {
    const work = this.handle(message).finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    try {
      const event = this.parse(message);
      if (!event) {
        await this.broker.publishDead(message.content);
      } else {
        await this.settle(event, await this.run(event), retriesOf(message));
      }
      this.broker.channel.ack(message);
    } catch (error) {
      // Broker or database trouble while settling: the message goes back, the lease protects the event.
      this.logger.error(
        `Could not settle message, requeueing: ${String(error)}`,
      );
      this.requeue(message);
    }
  }

  /** Best effort: if the channel is gone the broker redelivers the message anyway. */
  private requeue(message: ConsumeMessage): void {
    try {
      this.broker.channel.nack(message, false, true);
    } catch (error) {
      this.logger.warn(
        `Could not nack, relying on broker redelivery: ${String(error)}`,
      );
    }
  }

  private parse(message: ConsumeMessage): EventMessage | undefined {
    try {
      return eventMessageSchema.parse(JSON.parse(message.content.toString()));
    } catch (error) {
      this.logger.error(
        `Unparseable message moved to the dead-letter queue: ${String(error)}`,
      );
      return undefined;
    }
  }

  /** An unexpected error (e.g. MongoDB down) is not the event's fault: delay it instead of losing or spinning on it. */
  private async run(event: EventMessage): Promise<Outcome> {
    try {
      return await this.processor.process(event);
    } catch (error) {
      this.logger.error(
        `Event ${event.eventKey} could not be processed: ${String(error)}`,
      );
      return 'retry';
    }
  }

  private async settle(
    event: EventMessage,
    outcome: Outcome,
    retries: number,
  ): Promise<void> {
    if (outcome === 'retry') await this.broker.publishRetry(event, retries);
    if (outcome === 'dead-letter')
      await this.broker.publishDead(Buffer.from(JSON.stringify(event)));
  }
}

function retriesOf(message: ConsumeMessage): number {
  const retries = Number(message.properties.headers?.[RETRIES_HEADER]);
  return Number.isInteger(retries) && retries > 0 ? retries : 0;
}
