import { Module } from '@nestjs/common';
import { BrokerService } from './broker.service.js';

@Module({ providers: [BrokerService], exports: [BrokerService] })
export class MessagingModule {}
