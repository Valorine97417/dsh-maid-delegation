import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DEFAULT_DELEGATION_GUIDANCE } from '../lib/index.js';

// 只读对照迁移源；日常 node --test 不依赖外部仓库。
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/verify-source.mjs <source-cordis.patch.yml>');
const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const lines = source.split('\n');
let count = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].trimStart().startsWith('【子智能体委派纪律（强制执行，优先级高于你的惰性）】')) continue;
  const indent = lines[i].match(/^\s*/)[0].length;
  const block = [];
  for (; i < lines.length; i++) {
    block.push(lines[i].slice(indent));
    if (lines[i].trimStart().startsWith('唯一例外：')) break;
  }
  assert.equal(block.join('\n'), DEFAULT_DELEGATION_GUIDANCE);
  count++;
}
assert.equal(count, 3, 'Expected three static persona guidance copies');
console.log(`Static guidance parity: ${count}/3 copies identical`);
