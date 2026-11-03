import { z } from 'zod';
import { type Json, jsonSchema } from '../shared/json';

export const toolOutputSchema = jsonSchema.optional().catch(undefined);

const imageBlock = z.looseObject({ type: z.enum(['image', 'inputImage']) });

const withoutImages = (output: Json | undefined) =>
  Array.isArray(output) ? output.map(item => (imageBlock.safeParse(item).success ? { type: 'image' } : item)) : output;

export function toolOutputExcerpt(output: Json | undefined, limit: number) {
  const shown = withoutImages(output);
  const text = z.string().safeParse(shown);

  return (text.success ? text.data : JSON.stringify(shown ?? '')).slice(-limit);
}
