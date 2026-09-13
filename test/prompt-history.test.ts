import { expect, test } from 'bun:test';
import { pushHistory, stepHistory } from '../web/src/lib/promptHistory';

test('history keeps the newest brief first without duplicates or blanks', () => {
  let history: string[] = [];
  history = pushHistory(history, 'add a budget page');
  history = pushHistory(history, '  fix the csv import  ');
  history = pushHistory(history, 'add a budget page');
  expect(pushHistory(history, '   ')).toBe(history);
  expect(history).toEqual(['add a budget page', 'fix the csv import']);
  expect(pushHistory(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
});

test('arrow keys walk back through history and return to an empty field', () => {
  expect(stepHistory(2, -1, 'ArrowUp')).toBe(0);
  expect(stepHistory(2, 0, 'ArrowUp')).toBe(1);
  expect(stepHistory(2, 1, 'ArrowUp')).toBe(1);
  expect(stepHistory(2, 1, 'ArrowDown')).toBe(0);
  expect(stepHistory(2, 0, 'ArrowDown')).toBe(-1);
  expect(stepHistory(2, -1, 'ArrowDown')).toBe(-1);
  expect(stepHistory(0, -1, 'ArrowUp')).toBe(-1);
});
