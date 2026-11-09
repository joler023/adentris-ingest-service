import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CreateEventDto } from '../events/create-event.schema.js';
import { eventKeyOf } from '../events/event-key.js';
import type { EventMessage } from '../events/event-message.js';
import { BrokerService } from '../messaging/broker.service.js';

@Injectable()
export class IngestService {
  constructor(private readonly broker: BrokerService) {}

  /**
   * Hands the event to the broker and returns once the broker confirmed it
   * durably. Nothing is processed here. Duplicates are published again on
   * purpose: the worker deduplicates by `eventKey`.
   */
  async accept(dto: CreateEventDto): Promise<EventMessage> {
    const message: EventMessage = {
      eventKey: eventKeyOf(dto),
      patientId: dto.patientId,
      type: dto.type,
      data: dto.data,
      ts: new Date(dto.ts).toISOString(),
      receivedAt: new Date().toISOString(),
    };
    try {
      await this.broker.publishEvent(message);
    } catch (error) {
      throw new ServiceUnavailableException(
        'Event could not be accepted, retry later',
        { cause: error },
      );
    }
    return message;
  }
}
