import { INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { setupApiDocs } from './ingest/api-docs.js';

/** Everything the API process adds on top of the module graph; shared with the tests. */
export function configureApi(app: INestApplication): void {
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  setupApiDocs(app);
}
