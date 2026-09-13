import { isAutonomy, isHarness } from '../shared/domain';

export function text(value: unknown, name: string, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${name} is required and must be under ${limit} characters`);
  return value.trim();
}

export function optionalCommand(value: unknown, name: string): string[] {
  if (value === undefined || (Array.isArray(value) && !value.length)) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some(arg => typeof arg !== 'string' || arg.length > 2000) || !value[0].trim()) {
    throw new Error(`${name} command is required, with up to 30 arguments`);
  }
  return value;
}

export function titleFrom(description: string) {
  const line = (description.split('\n').find(part => part.trim()) ?? '').trim().replace(/\s+/g, ' ');
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

export function validHarness(value: unknown) {
  if (!isHarness(value)) throw new Error('Choose Codex, Claude, or OpenCode');
  return value;
}

export function validAutonomy(value: unknown) {
  if (!isAutonomy(value)) throw new Error('Choose how independently the agent works');
  return value;
}
