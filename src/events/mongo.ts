import { ConfigService } from '@nestjs/config';
import type { MongooseModuleAsyncOptions } from '@nestjs/mongoose';
import type { Env } from '../config/env.js';

export const mongoOptions: MongooseModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    uri: config.get('MONGODB_URI', { infer: true }),
  }),
};
