import { expect, test } from 'bun:test';
import { commandFromBlock, commandFromInline } from '../web/src/lib/shellCommands';

test('shell blocks in agent messages become runnable commands', () => {
  expect(commandFromBlock('sh', 'bun install\nbun run dev')).toBe('bun install\nbun run dev');
  expect(commandFromBlock('console', '$ bun test\n 15 pass\n 0 fail')).toBe('bun test');
  expect(commandFromBlock('', '$ cd app\n$ npm start')).toBe('cd app\nnpm start');
  expect(commandFromBlock('', '# start the server\nbun run dev')).toBe('# start the server\nbun run dev');
  expect(commandFromBlock('console', ' 15 pass\n 0 fail')).toBeNull();
  expect(commandFromBlock('ts', 'const total = 1;')).toBeNull();
  expect(commandFromBlock('', 'Imported 12 of 14 rows')).toBeNull();
  expect(commandFromBlock('', '# just a note')).toBeNull();
});

test('inline code is runnable when it is a complete command for a known tool', () => {
  expect(commandFromInline('npm run ui')).toBe('npm run ui');
  expect(commandFromInline('npm run ui -- --port 5000')).toBe('npm run ui -- --port 5000');
  expect(commandFromInline('node bin/ledger.js ...')).toBeNull();
  expect(commandFromInline('ledger import <file>')).toBeNull();
  expect(commandFromInline('src/import/csv.ts')).toBeNull();
  expect(commandFromInline('ls')).toBeNull();
});
