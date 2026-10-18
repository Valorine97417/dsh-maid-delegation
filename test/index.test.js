import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, SECTION_NAME, DEFAULT_DELEGATION_GUIDANCE, MAX_ATTEMPTS, RUNTIME_REMINDER, CONTEXT_NAME } from '../lib/index.js';

// 按缓存 system-prompt section/getSectionOrder 及 Cordis ctx.get/effect 契约 mock。
// 不伪装为真实宿主集成；section 同层重复名抛错，返回 disposer。
function fixture() {
  const handlers = new Set();
  const sections = new Map();
  const logs = [];
  let reads = 0;
  let calls = 0;
  let disposals = 0;
  const service = {
    getSectionOrder(key) { assert.equal(key, 'TOOL_SUBAGENT'); return 2800; },
    section(def) {
      calls++;
      assert.equal(typeof def.name, 'string');
      assert.ok(Number.isFinite(def.order));
      if (sections.has(def.name)) throw new Error('duplicate section');
      sections.set(def.name, def);
      let done = false;
      return () => { if (!done) { done = true; disposals++; sections.delete(def.name); } };
    },
  };
  const f = {
    service,
    available: service,
    getError: null,
    sections, handlers, logs,
    get reads() { return reads; },
    get calls() { return calls; },
    get disposals() { return disposals; },
    ctx: {
      get(key) {
        reads++;
        assert.equal(key, 'systemPrompt');
        if (f.getError) throw f.getError;
        return f.available;
      },
      effect(setup, label) {
        assert.equal(label, 'dsh-maid-delegation:lifecycle');
        const cleanup = setup();
        const dispose = () => { if (handlers.delete(dispose)) cleanup(); };
        handlers.add(dispose);
        return dispose;
      },
      logger: { info: (text) => logs.push(text), warn: (text) => logs.push(text) },
    },
    dispose() { for (const handler of [...handlers]) handler(); },
  };
  return f;
}

function clock(t) { t.mock.timers.enable({ apis: ['setTimeout'] }); }

test('默认启用：唯一 section、静态纪律、顺序与纯文本', () => {
  const f = fixture(); apply(f.ctx);
  assert.deepEqual(f.sections.get(SECTION_NAME), {
    name: SECTION_NAME, order: 2801, text: DEFAULT_DELEGATION_GUIDANCE, interpolate: false,
  });
  assert.ok(f.logs.some(x => x.includes('已挂载')));
  f.dispose(); assert.equal(f.sections.size, 0);
});

test('enabled false：不读服务、不注册生命周期', () => {
  const f = fixture(); apply(f.ctx, { enabled: false });
  assert.equal(f.reads, 0); assert.equal(f.handlers.size, 0); assert.equal(f.calls, 0);
});

test('自定义 guidance 按纯文本注册', () => {
  const f = fixture(); apply(f.ctx, { guidance: '  字面量 {{unknown}}  ' });
  assert.equal(f.sections.get(SECTION_NAME).text, '字面量 {{unknown}}');
  assert.equal(f.sections.get(SECTION_NAME).interpolate, false); f.dispose();
});

test('空白及错误类型 guidance 回退默认', () => {
  for (const guidance of ['', '  \n', null, 123]) {
    const f = fixture(); apply(f.ctx, { guidance });
    assert.equal(f.sections.get(SECTION_NAME).text, DEFAULT_DELEGATION_GUIDANCE); f.dispose();
  }
});

test('无顺序 API 或非有限顺序时回退 2801', () => {
  for (const getter of [undefined, () => undefined, () => NaN, () => Infinity]) {
    const f = fixture(); f.service.getSectionOrder = getter; apply(f.ctx);
    assert.equal(f.sections.get(SECTION_NAME).order, 2801); f.dispose();
  }
});

test('延迟服务就绪后重试挂载一次', t => {
  clock(t); const f = fixture(); f.available = undefined; apply(f.ctx);
  assert.equal(f.reads, 1); t.mock.timers.tick(1000); assert.equal(f.reads, 2);
  f.available = f.service; t.mock.timers.tick(1000); assert.equal(f.calls, 1);
  t.mock.timers.tick(10000); assert.equal(f.reads, 3); f.dispose();
});

test('等待期卸载清理 timer，不会死灰复燃', t => {
  clock(t); const f = fixture(); f.available = undefined; apply(f.ctx); f.dispose();
  f.available = f.service; t.mock.timers.tick(30000);
  assert.equal(f.reads, 1); assert.equal(f.calls, 0); assert.equal(f.handlers.size, 0);
});

test('重试上限 20 次、日志可见且停止', t => {
  clock(t); const f = fixture(); f.available = undefined; apply(f.ctx);
  for (let i = 0; i < 40; i++) t.mock.timers.tick(1000);
  assert.equal(f.reads, MAX_ATTEMPTS); assert.equal(f.calls, 0);
  assert.ok(f.logs.some(x => x.includes('等待超限 (20 次)'))); f.dispose();
});

test('重复 apply：已挂载状态不重复 section 或 listener', () => {
  const f = fixture(); apply(f.ctx); apply(f.ctx, { guidance: '不热替换' });
  assert.equal(f.calls, 1); assert.equal(f.handlers.size, 1);
  assert.equal(f.sections.get(SECTION_NAME).text, DEFAULT_DELEGATION_GUIDANCE); f.dispose();
});

test('重复 apply：等待状态不增加重试链', t => {
  clock(t); const f = fixture(); f.available = undefined;
  apply(f.ctx); apply(f.ctx); t.mock.timers.tick(1000);
  assert.equal(f.reads, 2); assert.equal(f.handlers.size, 1); f.dispose();
});

test('section 抛错有日志、不盲重试，卸载后允许再挂', t => {
  clock(t); const f = fixture();
  const original = f.service.section;
  f.service.section = () => { throw new Error('section exploded'); };
  apply(f.ctx); t.mock.timers.tick(30000);
  assert.equal(f.reads, 1); assert.ok(f.logs.some(x => x.includes('section exploded')));
  f.dispose(); f.service.section = original; apply(f.ctx);
  assert.equal(f.sections.size, 1); f.dispose();
});

test('ctx.get 抛错显式日志并可恢复', t => {
  clock(t); const f = fixture(); f.getError = new Error('get exploded'); apply(f.ctx);
  assert.ok(f.logs.some(x => x.includes('get exploded')));
  f.getError = null; t.mock.timers.tick(1000); assert.equal(f.calls, 1); f.dispose();
});

test('服务接口缺失显式日志，等待后恢复', t => {
  clock(t); const f = fixture(); f.available = {}; apply(f.ctx);
  assert.ok(f.logs.some(x => x.includes('section 不可用')));
  f.available = f.service; t.mock.timers.tick(1000); assert.equal(f.calls, 1); f.dispose();
});

test('顺序服务抛错及非 disposer 返回值均可见', () => {
  const a = fixture(); a.service.getSectionOrder = () => { throw new Error('order exploded'); };
  apply(a.ctx); assert.ok(a.logs.some(x => x.includes('order exploded'))); a.dispose();
  const b = fixture(); b.service.section = () => undefined; apply(b.ctx);
  assert.ok(b.logs.some(x => x.includes('did not return a disposer'))); b.dispose();
});

test('生命周期注册失败不挂载、不留状态', () => {
  const f = fixture(); const effect = f.ctx.effect;
  f.ctx.effect = () => { throw new Error('effect exploded'); }; apply(f.ctx);
  assert.equal(f.calls, 0); assert.ok(f.logs.some(x => x.includes('effect exploded')));
  f.ctx.effect = effect; apply(f.ctx); assert.equal(f.calls, 1); f.dispose();
});

test('卸载再挂：同 ctx 与不同 ctx 均独立', () => {
  const a = fixture(); const b = fixture(); apply(a.ctx); apply(b.ctx);
  a.dispose(); a.dispose(); assert.equal(a.disposals, 1); assert.equal(b.sections.size, 1);
  apply(a.ctx, { guidance: '第二次' }); assert.equal(a.calls, 2);
  assert.equal(a.sections.get(SECTION_NAME).text, '第二次'); a.dispose(); b.dispose();
  assert.equal(a.handlers.size, 0); assert.equal(b.handlers.size, 0);
});

test('卸载 disposer 异常记录日志，仍清理监听并可再挂', () => {
  const f = fixture(); f.service.section = () => () => { throw new Error('dispose exploded'); };
  apply(f.ctx); f.dispose(); assert.equal(f.handlers.size, 0);
  assert.ok(f.logs.some(x => x.includes('dispose exploded')));
  apply(f.ctx); assert.equal(f.handlers.size, 1); f.dispose();
});

test('logger 缺失或抛错时 console 提供可见失败日志', t => {
  const lines = []; t.mock.method(console, 'warn', text => lines.push(text));
  for (const logger of [undefined, { warn() { throw new Error('logger exploded'); } }]) {
    const f = fixture(); f.ctx.logger = logger;
    f.service.section = () => { throw new Error('visible failure'); };
    apply(f.ctx); f.dispose();
  }
  assert.equal(lines.filter(x => x.includes('visible failure')).length, 2);
});

test('第二通道：宿主提供 context 时额外注册运行时短提醒，卸载一并清掉', () => {
  const f = fixture();
  const contexts = new Map();
  f.service.getContextOrder = () => 120;
  f.service.context = (def) => {
    assert.ok(Number.isFinite(def.order));
    if (contexts.has(def.name)) throw new Error('duplicate context');
    contexts.set(def.name, def);
    return () => contexts.delete(def.name);
  };
  apply(f.ctx);
  assert.equal(f.sections.size, 1);
  assert.equal(contexts.size, 1);
  const reminder = [...contexts.values()][0];
  assert.equal(reminder.text, RUNTIME_REMINDER);
  assert.equal(reminder.interpolate, false);
  assert.equal(reminder.order, 121);
  f.dispose();
  assert.equal(contexts.size, 0);
  assert.equal(f.sections.size, 0);
});

test('第二通道：宿主无 context API 时静默跳过，主 section 不受影响', () => {
  const f = fixture();
  apply(f.ctx);
  assert.equal(f.sections.size, 1);
  assert.equal(f.sections.get(SECTION_NAME).text, DEFAULT_DELEGATION_GUIDANCE);
  f.dispose();
});

test('第二通道：context 注册抛错时记日志，主 section 仍在', () => {
  const f = fixture();
  f.service.getContextOrder = () => 120;
  f.service.context = () => { throw new Error('context exploded'); };
  apply(f.ctx);
  assert.equal(f.sections.size, 1);
  assert.ok(f.logs.some(x => x.includes('context exploded')));
  f.dispose();
  assert.equal(f.sections.size, 0);
});

test('第二通道：runtimeReminder false 时只挂主 section', () => {
  const f = fixture();
  const contexts = new Map();
  f.service.getContextOrder = () => 120;
  f.service.context = (def) => { contexts.set(def.name, def); return () => contexts.delete(def.name); };
  apply(f.ctx, { runtimeReminder: false });
  assert.equal(f.sections.size, 1);
  assert.equal(contexts.size, 0);
  f.dispose();
});

test('第二通道：getContextOrder 存在但返回非有限时回退 121；缺失 API 时跳过', () => {
  for (const getter of [() => undefined, () => NaN, () => Infinity]) {
    const f = fixture();
    const seen = [];
    f.service.getContextOrder = getter;
    f.service.context = (def) => { seen.push(def); return () => {}; };
    apply(f.ctx);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].order, 121);
    assert.equal(seen[0].name, CONTEXT_NAME);
    f.dispose();
  }
  // 宿主完全没有 getContextOrder 时不注册第二通道，主 section 仍在。
  const missing = fixture();
  const seen = [];
  missing.service.context = (def) => { seen.push(def); return () => {}; };
  apply(missing.ctx);
  assert.equal(seen.length, 0);
  assert.equal(missing.sections.size, 1);
  missing.dispose();
});

test('第二通道：context 返回非 disposer 时记日志且不污染卸载', () => {
  const f = fixture();
  f.service.getContextOrder = () => 120;
  f.service.context = () => undefined;
  apply(f.ctx);
  assert.equal(f.sections.size, 1);
  assert.ok(f.logs.some(x => x.includes('context')));
  f.dispose();
  assert.equal(f.sections.size, 0);
});

test('第二通道：runtimeReminderRequired 时给条目加 required', () => {
  const f = fixture();
  const seen = [];
  f.service.getContextOrder = () => 120;
  f.service.context = (def) => { seen.push(def); return () => {}; };
  apply(f.ctx, { runtimeReminderRequired: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].required, true);
  f.dispose();
});

test('第二通道：默认不带 required，尊重 preset 的 suppress 意图', () => {
  const f = fixture();
  const seen = [];
  f.service.getContextOrder = () => 120;
  f.service.context = (def) => { seen.push(def); return () => {}; };
  apply(f.ctx);
  assert.equal(seen.length, 1);
  assert.equal('required' in seen[0], false);
  f.dispose();
});

test('运行时提醒带生效前提，避免与子代理深度限制字面冲突', () => {
  // 本条注册在全局层会继承进子代理 scope；宿主 order 120 的 depth 提示可能
  // 说「当前深度禁止再派」，本条排 121 更醒目，首句必须先声明适用前提。
  assert.ok(RUNTIME_REMINDER.startsWith('（仅当当前不在子代理内、且委派深度未触顶时适用）'),
    '运行时提醒缺少生效前提声明');
  assert.ok(RUNTIME_REMINDER.includes('先开 subagent 派出去'));
});

test('manifest 提供 ESM 与独立 bundle 入口，仅加载插件无 preset/routes/seed', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'dsh-maid-delegation'); assert.equal(pkg.version, '0.2.0');
  assert.ok(pkg.description.startsWith('DSH 小困插件 · 子智能体委派：'));
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.dsh, { bundle: { patch: './cordis.patch.yml' } });
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml');
  assert.ok(pkg.files.includes('cordis.patch.yml')); assert.ok(pkg.files.includes('LICENSE'));
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  // 宿主 bundle patch 必须以顶层 - insert: 原语书写；裸写 - id: 会被重装配静默跳过。
  assert.equal((patch.match(/^- insert:/gm) ?? []).length, 1);
  assert.equal((patch.match(/^\s+- id: /gm) ?? []).length, 1);
  assert.match(patch, /name: 'dsh-maid-delegation'\n/);
  assert.match(patch, /enabled: true/);
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(pkg.peerDependencies), ['@deepseek-ai/cordis']);
});
