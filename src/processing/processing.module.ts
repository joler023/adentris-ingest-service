import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { EventConsumer } from './event-consumer.service.js';
import { EventProcessor } from './event-processor.service.js';
import { ExternalSystemClient } from './external-system.client.js';

@Module({
  imports: [EventsModule, MessagingModule],
  providers: [EventConsumer, EventProcessor, ExternalSystemClient],
})
export class ProcessingModule {}
