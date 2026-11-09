import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { EventsController } from './events.controller.js';
import { IngestService } from './ingest.service.js';

@Module({
  imports: [EventsModule, MessagingModule],
  controllers: [EventsController],
  providers: [IngestService],
})
export class IngestModule {}
