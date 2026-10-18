import assert from 'node:assert/strict';
import { DEFAULT_DELEGATION_GUIDANCE, RUNTIME_REMINDER } from '../lib/index.js';

// 结构契约校验：纪律文本从「原则陈述」改成「动作序列」后，逐字比对旧快照
// 已无意义（旧脚本 verify-source.mjs 保留作历史对照，不再进默认流程）。
// 这里改为校验「弱模型能照做」所依赖的结构要素是否齐全。

const text = DEFAULT_DELEGATION_GUIDANCE;

// 1) 七个步骤标题必须齐全且按序出现。
const steps = [
  '第一步·任务分类',
  '第二步·封堵借口',
  '第三步·必须委派的场景',
  '第四步·真并发',
  '第五步·工具选型',
  '第六步·委派 prompt 必须自带四件',
  '第七步·收口纪律',
];
let cursor = -1;
for (const step of steps) {
  const at = text.indexOf(step);
  assert.notEqual(at, -1, `缺少步骤：${step}`);
  assert.ok(at > cursor, `步骤顺序错误：${step}`);
  cursor = at;
}

// 2) 五种借口必须逐条封堵（这是对抗弱模型偷懒的核心）。
const excuses = [
  '我先自己看看',
  '这个任务很简单',
  '我自己做更快',
  '我模型能力够',
  '等一会儿再派',
];
for (const excuse of excuses) {
  assert.ok(text.includes(excuse), `缺少借口封堵：${excuse}`);
}

// 3) 硬阈值与并发纪律必须原样出现。
assert.ok(text.includes('超过 3 次工具调用'), '缺少工具调用次数阈值');
assert.ok(text.includes('同一条消息里一次性发起多个'), '缺少真并发要求');
assert.ok(text.includes('绝不许串行'), '缺少禁止串行的表述');

// 4) 三种委派工具的选型都必须写明。
for (const tool of ['subagent', 'subagent_fork', 'workflow']) {
  assert.ok(text.includes(tool), `缺少工具选型：${tool}`);
}

// 5) 运行时提醒必须短（太长就失去「贴末尾短句」的优势）且含硬动作。
assert.ok(RUNTIME_REMINDER.length <= 200, `运行时提醒过长：${RUNTIME_REMINDER.length} 字符`);
assert.ok(RUNTIME_REMINDER.includes('subagent'), '运行时提醒缺少 subagent 动作');
assert.ok(RUNTIME_REMINDER.includes('同一条消息并发多个'), '运行时提醒缺少并发要求');

console.log(`Guidance contract: ${steps.length} steps, ${excuses.length} excuse blockades, reminder ${RUNTIME_REMINDER.length} chars — all present`);
