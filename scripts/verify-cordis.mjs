import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as plugin from '../lib/index.js';

// 显式传入缓存 Cordis ESM 入口，不绑定开发者机器路径、不增加依赖。
// 此脚本不由默认 node --test 自动发现；用 node --test scripts/verify-cordis.mjs 执行。
if (!process.env.CORDIS_MODULE) throw new Error('Set CORDIS_MODULE to the real Cordis lib/index.js absolute path');
const { Context } = await import(pathToFileURL(process.env.CORDIS_MODULE).href);

function fixture(available = true) {
  const root = new Context();
  const sections = new Map();
  let calls = 0;
  let disposals = 0;
  const service = {
    getSectionOrder() { return 2800; },
    section(def) {
      calls++;
      assert.equal(sections.has(def.name), false, 'duplicate active section');
      sections.set(def.name, def);
      let done = false;
      return () => { if (!done) { done = true; disposals++; sections.delete(def.name); } };
    },
  };
  if (available) root.provide('systemPrompt', service);
  return { root, service, sections, get calls() { return calls; }, get disposals() { return disposals; } };
}

test('真实 Cordis 4 Fiber restart/unload 清理并重新挂载', async () => {
  const f = fixture();
  const fiber = f.root.plugin(plugin); await fiber.await();
  assert.equal(f.calls, 1); assert.equal(f.disposals, 0);
  await fiber.restart();
  assert.equal(f.calls, 2); assert.equal(f.disposals, 1); assert.equal(f.sections.size, 1);
  await fiber.dispose();
  assert.equal(f.calls, 2); assert.equal(f.disposals, 2); assert.equal(f.sections.size, 0);
});

test('真实 Cordis Fiber 卸载等待 timer 后服务晚到不会重挂', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(false);
  const fiber = f.root.plugin(plugin); await fiber.await();
  await fiber.dispose();
  f.root.provide('systemPrompt', f.service);
  for (let i = 0; i < 30; i++) t.mock.timers.tick(1000);
  assert.equal(f.calls, 0); assert.equal(f.disposals, 0);
});

test('真实 Cordis Fiber 等待期 restart 清旧 timer/状态，新期就绪后挂载一次', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(false);
  const fiber = f.root.plugin(plugin); await fiber.await();
  await fiber.restart();
  f.root.provide('systemPrompt', f.service);
  t.mock.timers.tick(1000);
  assert.equal(f.calls, 1); assert.equal(f.sections.size, 1);
  await fiber.dispose();
  for (let i = 0; i < 30; i++) t.mock.timers.tick(1000);
  assert.equal(f.calls, 1); assert.equal(f.disposals, 1); assert.equal(f.sections.size, 0);
});
