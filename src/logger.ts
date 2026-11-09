import { ConsoleLogger } from '@nestjs/common';

/**
 * One JSON object per line, fields at the root, so the output can be shipped to
 * any log aggregator. Level filter: NEST_LOG_LEVEL (e.g. `warn`, `>=log`).
 * Event and patient data is never logged on purpose; `redact` is the safety net
 * in case a future log line passes an object that contains them.
 */
export const createLogger = () =>
  new ConsoleLogger({
    json: true,
    flattenParams: true,
    redact: ['patientId', 'data', 'result'],
  });

/** Error text for a log field: never the error object, which can carry request data. */
export const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
