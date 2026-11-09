import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

export const DOCS_PATH = '/docs';
export const OPENAPI_PATH = '/openapi.json';

/** OpenAPI document (generated from the controllers) at /openapi.json, rendered by Scalar at /docs. */
export function setupApiDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Ingest Service')
    .setDescription(
      'Accepts patient events and processes them asynchronously, exactly once.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(DOCS_PATH, app, document, {
    ui: false,
    jsonDocumentUrl: OPENAPI_PATH,
  });
  app.use(DOCS_PATH, apiReference({ content: document }));
}
