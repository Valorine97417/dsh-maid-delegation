# 故障排查

## 真实问题记录

当前运行宿主已安装插件的线上事故记录如下；开发审查另复现过若干生命周期缺陷（基础测试为契约 mock，额外回归使用真实缓存 Cordis Context/Fiber，不冒充宿主会话验收）。

### 线上真实问题：弱模型派子智能体但「各做各的」（v0.2.1 修复）

- 症状：老大 2026-10-18 反馈「隔壁这个会话在用其他模型跑子智能体，但看起来像是各做各的。」弱模型被踹醒开始并发派活后，两个子代理互相撞车、重复劳动，交卷时主模型生硬拼盘。
- 原因：弱模型缺少正交切分意识与角色边界契约。①并发时盲目撒网，任务切分模糊，两人都在查同一片区域；②派工 prompt 没写角色契约（未限定你负责哪块、别人负责哪块、不要跨界包揽），子代理各自单挑全盘；③交卷时主模型不做交叉验证抹平矛盾，像拼盘一样生拼。
- 解法：升级为 v0.2.1：
  1. 第四步强化「【正交铁律】职责范围必须绝对互斥（A 查前端/B 查后端，A 查代码/B 查配置），严禁派模糊重叠的活踩脚」；
  2. 第六步升级为五件套，强制必须带「角色分工契约（说明你负责哪一块、别人负责哪一块，不要越界包揽）」；
  3. 第七步强化「收口纪律与交叉对账，主会话抹平矛盾自洽汇报，严禁生拼拼盘」；
  4. 次通道短提醒增加「正交分工、严禁重叠撞车、交叉对账防拼盘」要求。
- 验证：`node scripts/verify-guidance.mjs` 校验 7 步按序、5 借口全堵、正交铁律、角色分工、禁止拼盘与短提醒 138 字符全部断言通过；`node --test` 28/28 全绿。

### 线上真实问题：换成第三方模型后不派子智能体（v0.2.0 修复）

- 症状：老大 2026-10-18 反馈「目前使用下来，我一换成其他模型。就没有派子智能体干活了。」所选路由为 CodeBuddy(腾讯) Deepseek-V4.1-Flash；同会话换回自家模型立刻恢复派活。
- 核实过程：先排除插件失效——重启后 `C:/Users/Kayle/.dsh/profiles/desktop/cordis.yml` 中 `dsh-maid-delegation` 条目与 `enabled: true` 都在，挂载日志正常，会话系统提示词里确实带着【子智能体委派纪律】。所以不是没加载，是加载了照旧不听。
- 原因：**不是插件挂了，是纪律的写法对弱模型无效**。v0.1.0 的文本是「原则陈述」型——「你的默认反应必须是…」「判断标准只有一条…」，靠模型自觉内化。强模型能从中推出动作序列，弱模型只把它当背景描述，读完照旧自己一件件抠。
- 解法：v0.2.0 把纪律改写成**动作序列 + 借口封堵**——第一步任务分类（超过 3 次工具调用即委派）→ 第二步把「我先自己看看」「这个任务很简单」「我自己做更快」「我模型能力够」「等一会儿再派」五种借口逐条堵死 → 第三步强触发场景 → 第四步真并发 → 第五步工具选型 → 第六步派工四件套 → 第七步收口纪律。同时新增**第二通道** `systemPrompt.context`：在运行时快照里放一句 113 字硬提醒（entry 名 `dsh-maid-delegation:reminder`，order `SUBAGENT_DELEGATION + 1 = 121`），因为弱模型对贴近提示词末尾的短句遵循率高于长文中段。可用 `runtimeReminder: false` 单独关掉次通道。
- 验证：`node --test` 28/28（含次通道四态与 required 开关）；真实 Cordis 4.0.1 生命周期回归 3/3；`node scripts/verify-guidance.mjs` 输出 `Guidance contract: 7 steps, 5 excuse blockades, reminder 113 chars — all present`。

### 次通道新增时踩到：聚合 disposer 吞掉异常导致测试红

- 症状：加完第二通道后，原有测试「卸载 disposer 异常记录日志，仍清理监听并可再挂」由通过变失败。
- 原因：初版聚合 disposer 用 `try { d(); } catch { /* 静默 */ }` 包住每个通道，第三方 disposer 抛错被吞掉，`cleanup` 的 catch 再也拿不到异常，日志里就没有 `dispose exploded`。
- 解法：聚合 disposer 收集所有失败，末尾 `throw failures[0]` 交回 `cleanup` 的 catch 记日志——既保证所有通道都尝试卸载，又不让失败静默。
- 验证：该测试恢复通过，25/25 全绿。

### 次通道可能失效的场景：被 suppressRuntimeContext 抑制

- 症状：挂载日志显示 `通道: 2`，但最终提示词里搜不到那句短提醒。
- 原因（真实宿主代码实证）：`refreshContext` 在 `D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-system-prompt\lib\index.js:326` 计算 `suppressed`，`:331-332` 对非 `required` 条目直接 `required.delete(accepted.name); if (suppressed && provider?.required !== true) continue;` —— **静默跳过，无日志无告警**。`assemble()` 侧 `:394` 同规则过滤，`:399-405` waterfall 后再二次裁剪。唯一 suppressor 源头是 `dsh-persona\lib\index.js:47`：`if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext();`
- 现状核实：desktop profile 里 `includeRuntimeContext` 只有两处——`:1183 false`（属 `preset-minimal`，非当前选中）、`:1547 true`（属 `preset-whale-girl`，其 `:1531 disabled: true`）。当前在用的 `preset-maid`（`:1747` 起）persona 段无该字段 → 默认 true → **不 suppress，次通道当前生效**。`D:\Works By DSH\dsh-maid-preset` 全目录零命中。
- 解法：① 别给 `preset-maid` 的 persona 补 `includeRuntimeContext: false`；② 需要硬保活时设 `runtimeReminderRequired: true`（探针实测：suppress 下 `contexts` 仍为 `["dsh-maid-delegation:reminder"]`）；③ 主 section 通道不受 suppress 影响，实测三组场景「system prompt 含 section」恒为 true。
- 验证：在宿主最终提示词里搜 `委派纪律仍然生效`；或按 `_probe/e2e/probe-scope2.mjs` 复跑 A/B 两组对照。

### 次通道会继承进子代理，与深度限制字面冲突

- 症状：子代理会话的运行时快照里，宿主 order 120 的 depth 提示写着 `Delegation depth for 'subagent': … remaining levels 0. Do not call 'subagent' at this depth`，紧跟其后（order 121）是我们的「先开 subagent 派出去」，更醒目，字面打架。
- 原因：本条目注册在**全局层**，随 scope 继承进每个子代理会话；排序只按 `order` 升序（`assemble:394`），所以排在宿主 depth 提示之后。
- 解法：提醒首句加生效前提——`（仅当当前不在子代理内、且委派深度未触顶时适用）`，让「不能派」的情形天然落在本条之外，**不依赖宿主内部字段**（不去读 `context.agent` 猜是不是子代理）。
- 验证：测试 `运行时提醒带生效前提，避免与子代理深度限制字面冲突` 守住该前缀；`_probe/e2e/probe-child-scope.mjs` 复跑子代理 scope 确认两句并存但边界先声明。

### 本次审查实际遇到：普通 dispose 事件不能代替 Fiber 生命周期

- 症状：初版 `ctx.on('dispose')` 在真实 Cordis 4.0.1 中，restart 后与最终卸载后均是注册/卸载计数 `1/0`；mock 手动发 dispose 的测试产生假阳性。
- 原因：`ctx.on` 仅注册普通事件，Fiber `_unload` 清理其 effects/disposables，不发出 dispose 事件，所以 timer、WeakMap 与 section disposer 没被本插件清理。
- 解法：已读真实 effect API，改为 `ctx.effect(() => cleanup)`，在插入 section 或启动 timer 之前登记清理；mock 也改为 effect 契约。
- 验证：真实 Cordis Context/Fiber 的 3 项回归通过：restart `2/1`、最终 unload `2/2`；等待期 unload 后服务晚到不重挂；等待期 restart 清旧 timer/状态并只挂新期一次。命令见 README。

### 本次开发实际遇到：参考依赖路径不存在

- 症状：读取 `D:/DeepSeek Harness/Works/dsh-maid-comfyui/node_modules` 返回 `NOT_FOUND`。
- 原因：用户提供的是参考位置，本机真实项目在 `D:/Works By DSH/dsh-maid-comfyui`；其 pnpm 缓存路径并非原参考路径。
- 解法：经只读定位后读取实际缓存 `@deepseek-ai/dsh-system-prompt` 的 `lib/index.js`，不安装、不改动参考项目，不把缓存版本称作当前宿主版本。
- 验证：已确认 `section()` 返回 disposer、同层重复名抛错、scope 合并与 complete 独占行为；运行宿主兼容性仍未验证。

### 本次开发实际遇到：Bash 找不到 npm

- 症状：`npm pack --dry-run` 返回 `/usr/bin/bash: line 1: npm: command not found`（127）。
- 原因：该 Bash PATH 无 npm 可执行入口；本机有 npm.cmd 与独立 npm CLI 脚本。
- 解法：使用 Node 调用实际入口，并将 cache 限定在本目录：`node 'C:/Users/Kayle/AppData/Local/Programs/npm/package/bin/npm-cli.js' pack --dry-run --cache 'D:/Works By DSH/dsh-maid-delegation/.npm-cache'`。
- 验证：干跑成功，7 个发布文件，包含 `cordis.patch.yml` 和 `LICENSE`；未安装或产生 tgz。

### 本次挂载实际遇到：cordis.patch.yml 漏写顶级 - insert: 导致被重写冲刷

- 症状：挂载重启后，`cordis.yml` 中手动写入的插件声明条目消失，插件未被宿主加载。
- 原因：`cordis.patch.yml` 顶级漏写 `- insert:` 原语，宿主启动重装配识别不出 patch 操作而跳过，且重新生成 `cordis.yml` 时覆盖了手动写入的条目。
- 解法：在 `cordis.patch.yml` 补全顶层 `- insert:` 原语，并在 `desktop/cordis.yml` 对齐声明。
- 验证：重启后 `cordis.yml` 稳定保留插件声明。

### 实测确认：子代理跑完后不是死的，等它完成也别轮询（2026-10-18，非事故）

- 症状：两个常见误判。① 以为子代理一旦交付就"关掉了"，后续想追问只能重开一个几乎一样的活，白烧一遍上下文；② 等子代理时不放心，反复去查状态、或者不敢结束本轮，把轮次空转着熬。
- 原因：完成态的子代理是**可续传的会话**，不是一次性进程——它的对话还在，`send_message` 能接着聊；同时子代理完成时宿主会主动发「Background subagent … finished」通知唤醒主代理，**等待不需要任何人的轮询**，正常结束轮次即可。
- 解法：① 同一条消息里并发派多个互斥子代理，各自用 `send_message` 回报；② 派完就结束本轮，等完成通知唤醒；③ 交付后要继续追问，直接对**已完成**的那个子代理再 `send_message`，不要重新派一个。
- 验证：`JASNA-DELEGATION-PROBE-01` 全链路实测通过（2026-10-18）：同一条消息并发两个 subagent（互斥任务）→ 各自 `send_message` 回报 → 完成后收到「Background subagent … finished」通知唤醒主代理 → 对已完成的子代理再 `send_message` 仍能续传并回话（A 回「续传确认」）。

## 预防性排查（契约测试或源码推导，非已发生事故）

| 症状 | 原因 | 解法 | 验证 |
| --- | --- | --- | --- |
| 没有挂载日志，section 不存在 | 本插件 `enabled: false`，或本地包未被加载 | 检查实际 Cordis 条目及包解析，启用后按宿主流程重载 | 应出现含 section 名的“已挂载”日志；disabled mock 验证服务调用为 0 |
| 日志提示“等待超限 (20 次)” | systemPrompt 未就绪，或启动顺序晚于等待窗口 | 确认服务就绪后重载插件，不增加并发限额 | 查看一次成功挂载；mock 验证恰好 20 次后不再调用 |
| 日志提示读取服务失败或 section 不可用 | `ctx.get` 异常或服务接口版本不匹配 | 根据异常检查宿主接口；修复后重载 | get/接口异常测试确认显式日志、等待恢复 |
| 日志提示 section 挂载失败 | 重名、顺序服务异常或非 disposer 接口 | 解除冲突/升级兼容服务；卸载后重载，不重复 apply 赌重试 | 对应失败日志含原始异常；mock 验证不盲重试 |
| 成功挂载但某会话仍看不到规则 | scope 不可见，或 complete 自定义 preset 排除了普通 section | 检查该会话的最终提示词装配与 preset；需规则时由配置维护者自行合并到 complete 文本 | 在宿主最终提示词中搜 section 或独特句；本轮未实测该集成行为 |
| 委派规则出现两遍 | 原 preset 静态人设仍有同一规则，或人为加载了其他副本 | 明确由哪一处提供；本轮不改原仓，可先停用本插件 | 对照最终提示词；`enabled: false` 不会删除旧人设纪律 |
| 模型未委派/无法委派 | 提示词非调度器；工具不可用、深度/权限限制或更高优先级协议生效 | 检查实际工具和宿主限制，不靠本插件绕过限制 | 查看工具可用列表与真实执行记录，不仅看提示词措辞 |
| 修改配置后仍旧文本 | 相同 ctx 重复 apply 防重，配置不支持原地热替换 | 正常卸载再加载 | mock 验证卸载后可挂新 guidance |
| 卸载时提示 disposer 异常 | 服务提供的 disposer 抛错 | 修复宿主服务；必要时按正常流程重启宿主清理服务状态 | 日志含原始异常，mock 确认其余监听清理；不承诺第三方副作用已撤销 |

## 重跑离线测试

在本目录执行 `node --test`（28/28 通过）与 `node --check lib/index.js`。静态迁移一致性可执行：

```bash
node scripts/verify-source.mjs 'D:/Works By DSH/_probe/preset-delegation-migration-20261018T082752Z/source/cordis.patch.yml'
```

预期输出：`Static guidance parity: 3/3 copies identical`。该命令只读迁移前备份快照，不依赖迁出后的源仓仍有规则，不改原仓或 profile。
