import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { envSchema } from './config/env.js';
import { mongoOptions } from './events/mongo.js';
import { ProcessingModule } from './processing/processing.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    MongooseModule.forRootAsync(mongoOptions),
    ProcessingModule,
  ],
})
export class WorkerModule {}
