import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MongooseModuleAsyncOptions } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { Env } from '../config/env.js';

const logger = new Logger('MongoDB');

export const mongoOptions: MongooseModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    uri: config.get('MONGODB_URI', { infer: true }),
    // Not the URI in the messages: it may carry credentials.
    connectionFactory: (connection: Connection) => {
      connection.on('connected', () => logger.log('MongoDB connected'));
      connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
      return connection;
    },
  }),
};
