import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel } from 'amqplib';
import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect,
} from 'amqp-connection-manager';
import type { Env } from '../config/env.js';
import type { EventMessage } from '../events/event-message.js';
import {
  assertTopology,
  DEAD_LETTER,
  EVENTS_EXCHANGE,
  partitionOf,
  partitionQueue,
  retryName,
  RETRIES_HEADER,
} from './topology.js';

const PUBLISH_TIMEOUT_MS = 5_000;

/** Owns the RabbitMQ connection. Every publish resolves only once the broker confirmed it. */
@Injectable()
export class BrokerService implements OnApplicationShutdown {
  private readonly connection: AmqpConnectionManager;
  readonly channel: ChannelWrapper;
  private readonly partitions: number;
  private readonly retryDelaysMs: number[];

  constructor(config: ConfigService<Env, true>) {
    this.partitions = config.get('PARTITIONS', { infer: true });
    this.retryDelaysMs = config.get('RETRY_DELAYS_MS', { infer: true });
    this.connection = connect([config.get('RABBITMQ_URL', { infer: true })]);
    this.channel = this.connection.createChannel({
      publishTimeout: PUBLISH_TIMEOUT_MS,
      setup: (channel: ConfirmChannel) =>
        assertTopology(channel, {
          partitions: this.partitions,
          retryDelaysMs: this.retryDelaysMs,
        }),
    });
  }

  /** Resolves once connected and the topology exists. */
  ready(): Promise<void> {
    return this.channel.waitForConnect();
  }

  /** First delivery of an accepted event. */
  async publishEvent(event: EventMessage): Promise<void> {
    await this.publish(EVENTS_EXCHANGE, event, 0);
  }

  /** Delayed redelivery: the longer it has been retried, the longer the wait (last delay repeats). */
  async publishRetry(event: EventMessage, retries: number): Promise<void> {
    const step = Math.min(retries, this.retryDelaysMs.length - 1);
    await this.publish(retryName(step), event, retries + 1);
  }

  /** `body` is the raw payload so even unparseable messages can be parked. */
  async publishDead(body: Buffer): Promise<void> {
    await this.channel.publish(DEAD_LETTER, '', body, { persistent: true });
  }

  private async publish(
    exchange: string,
    event: EventMessage,
    retries: number,
  ): Promise<void> {
    const routingKey = partitionQueue(
      partitionOf(event.patientId, this.partitions),
    );
    await this.channel.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventKey,
        headers: { [RETRIES_HEADER]: retries },
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
