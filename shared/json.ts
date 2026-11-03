import { z } from 'zod';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);

export const jsonObjectSchema = z.record(z.string(), jsonSchema);

export type JsonArguments = { [key: string]: Json | undefined };
