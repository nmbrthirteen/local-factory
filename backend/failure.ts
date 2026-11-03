import { z } from 'zod';

const optionalText = z.string().optional().catch(undefined);

const failureFields = z.looseObject({
  message: z.string().catch(''),
  stderr: optionalText,
  log: optionalText,
  code: optionalText,
});

// Thrown values are not always Errors, and process failures carry extra fields (stderr, log, code).
export const thrownSchema = z
  .union([z.string().transform(message => failureFields.parse({ message })), failureFields])
  .catch(failureFields.parse({ message: 'Unknown failure' }));

export type Failure = z.infer<typeof thrownSchema>;
