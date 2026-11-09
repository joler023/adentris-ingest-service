import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { envSchema } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { mongoOptions } from './events/mongo.js';
import { IngestModule } from './ingest/ingest.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    MongooseModule.forRootAsync(mongoOptions),
    IngestModule,
    HealthModule,
  ],
})
export class ApiModule {}
