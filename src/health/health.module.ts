import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MessagingModule } from '../messaging/messaging.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule, MessagingModule],
  controllers: [HealthController],
})
export class HealthModule {}
