import { z } from 'zod';
import { autonomyLevels, harnesses } from '../shared/domain';
import { type Json, jsonSchema } from '../shared/json';

export const textField = (name: string, limit: number) => {
  const error = `${name} is required and must be under ${limit} characters`;

  return z
    .string({ error })
    .refine(value => value.trim() !== '' && value.length <= limit, { error })
    .transform(value => value.trim());
};

export const commandField = (name: string) => {
  const error = `${name} command is required, with up to 30 arguments`;

  return z
    .array(z.string({ error }).max(2000, { error }), { error })
    .max(30, { error })
    .refine(args => args.length === 0 || args[0].trim() !== '', { error })
    .default([]);
};

export const harnessField = z.enum(harnesses, { error: 'Choose Codex, Claude, or OpenCode' });

export const autonomyField = z.enum(autonomyLevels, { error: 'Choose how independently the agent works' });

export const settledField = z.boolean({ error: 'Choose whether the task is settled' });

export const repositoryPathField = z
  .string({ error: 'Choose an absolute repository path' })
  .refine(path => path.startsWith('/'), { error: 'Choose an absolute repository path' });

export function titleFrom(description: string) {
  const line = (description.split('\n').find(part => part.trim()) ?? '').trim().replace(/\s+/g, ' ');

  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

export const decisionField = z.enum(['accept', 'decline', 'cancel'], { error: 'Invalid decision' });

export const answerBody = z.object({
  answers: z.record(z.string(), jsonSchema).optional().catch(undefined),
  decision: jsonSchema.optional(),
});

export type AnswerInput = z.infer<typeof answerBody>;

export function parseField<Field extends z.ZodType>(field: Field, value: Json | undefined): z.infer<Field> {
  const parsed = field.safeParse(value);

  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input');

  return parsed.data;
}
