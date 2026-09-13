import { expect, test } from 'bun:test';
import { searchPalette } from '../web/src/lib/palette';

const item = (group: string, label: string, detail?: string, keywords?: string) => ({ id: `${group}-${label}`, group, label, detail, keywords, run: () => {} });

const items = [
  item('Actions', 'New task', undefined, 'create'),
  item('Actions', 'Merge'),
  item('Tasks', 'fix the csv import', 'Check failed'),
  item('Tasks', 'add budget warnings', 'Check passed'),
  item('Tasks', 'import bank statements', 'Needs you'),
];

test('an empty query lists everything in its original order', () => {
  expect(searchPalette(items, '  ').map(entry => entry.label)).toEqual(items.map(entry => entry.label));
});

test('every word must match, word starts rank first, and groups keep their order', () => {
  expect(searchPalette(items, 'import').map(entry => entry.label)).toEqual(['import bank statements', 'fix the csv import']);
  expect(searchPalette(items, 'csv import').map(entry => entry.label)).toEqual(['fix the csv import']);
  expect(searchPalette(items, 'create').map(entry => entry.label)).toEqual(['New task']);
  expect(searchPalette(items, 'passed').map(entry => entry.label)).toEqual(['add budget warnings']);
  expect(searchPalette(items, 'a').map(entry => entry.label)).toEqual(['New task', 'add budget warnings', 'import bank statements', 'fix the csv import']);
  expect(searchPalette(items, 'zebra')).toEqual([]);
});
